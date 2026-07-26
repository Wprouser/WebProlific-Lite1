import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ITEM_IMAGE_REPOSITORY, ITEM_REPOSITORY } from '../repositories/tokens';
import { ItemImageRepository } from '../repositories/item-image.repository';
import { ItemRepository } from '../repositories/item.repository';
import { ItemImage } from '../domain/item-image.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { STORAGE_REPOSITORY } from '../../storage/repositories/tokens';
import { StorageRepository, StoredFileInput } from '../../storage/repositories/storage.repository';

const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'] as const;

@Injectable()
export class ItemImagesService {
  constructor(
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    @Inject(ITEM_IMAGE_REPOSITORY) private readonly itemImageRepository: ItemImageRepository,
    @Inject(STORAGE_REPOSITORY) private readonly storageRepository: StorageRepository,
  ) {}

  async upload(request: RequestWithAccess, itemId: string, file: StoredFileInput): Promise<ItemImage> {
    const item = await this.getItemOrThrow(itemId);
    assertOutletAccess(request, item.outletId, [...MUTATE_ROLES]);

    const existing = await this.itemImageRepository.findByItemId(itemId);
    const { url } = await this.storageRepository.save(file, `items/${itemId}`);

    // Spec: "the first image uploaded for an item is automatically
    // isPrimary: true; uploading subsequent images does not change the
    // primary."
    return this.itemImageRepository.create({
      itemId,
      url,
      isPrimary: existing.length === 0,
      sortOrder: existing.length,
    });
  }

  async setPrimary(request: RequestWithAccess, itemId: string, imageId: string): Promise<ItemImage> {
    const item = await this.getItemOrThrow(itemId);
    assertOutletAccess(request, item.outletId, [...MUTATE_ROLES]);

    const image = await this.getImageOrThrow(itemId, imageId);
    if (image.isPrimary) return image;

    const current = await this.itemImageRepository.findByItemId(itemId);
    const currentPrimary = current.find((candidate) => candidate.isPrimary);
    if (currentPrimary) await this.itemImageRepository.setPrimary(currentPrimary.id, false);

    return this.itemImageRepository.setPrimary(imageId, true);
  }

  async delete(request: RequestWithAccess, itemId: string, imageId: string): Promise<void> {
    const item = await this.getItemOrThrow(itemId);
    assertOutletAccess(request, item.outletId, [...MUTATE_ROLES]);

    const image = await this.getImageOrThrow(itemId, imageId);

    // Spec: "Deleting the current primary image, if other images exist,
    // promotes the next-oldest remaining image to primary automatically
    // rather than leaving the item with no primary image."
    const promotionCandidate = image.isPrimary
      ? await this.itemImageRepository.findOldestOtherForItem(itemId, imageId)
      : null;

    await this.itemImageRepository.delete(imageId);
    await this.storageRepository.delete(image.url);

    if (promotionCandidate) {
      await this.itemImageRepository.setPrimary(promotionCandidate.id, true);
    }
  }

  async list(request: RequestWithAccess, itemId: string): Promise<ItemImage[]> {
    const item = await this.getItemOrThrow(itemId);
    assertOutletAccess(request, item.outletId);
    return this.itemImageRepository.findByItemId(itemId);
  }

  private async getItemOrThrow(itemId: string) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    return item;
  }

  private async getImageOrThrow(itemId: string, imageId: string): Promise<ItemImage> {
    const image = await this.itemImageRepository.findById(imageId);
    if (!image || image.itemId !== itemId) {
      throw new NotFoundException(`Image ${imageId} not found for item ${itemId}`);
    }
    return image;
  }
}
