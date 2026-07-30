import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ItemImagesService } from './item-images.service';
import { ItemRepository } from '../repositories/item.repository';
import { ItemImageRepository } from '../repositories/item-image.repository';
import { StorageRepository } from '../../storage/repositories/storage.repository';
import { Item } from '../domain/item.entity';
import { ItemImage } from '../domain/item-image.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'RICE-BAS-001',
    barcode: null,
    unitId: 'u1',
    minStock: '10',
    maxStock: '100',
    currentStock: '0',
    shelfLifeDays: 365,
    costPrice: '85.50',
    defaultSupplierId: null,
    purchaseGLAccount: null,
    defaultTaxRateId: null,
    storageLocation: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fixtureImage(overrides: Partial<ItemImage> = {}): ItemImage {
  return {
    id: 'img1',
    itemId: 'i1',
    url: '/uploads/items/i1/img1.jpg',
    isPrimary: false,
    sortOrder: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function fixtureRequest(role: string | null = 'OUTLET_MANAGER'): RequestWithAccess {
  return {
    user: { id: 'u1' },
    effectiveAccess: {
      userId: 'u1',
      effectiveOutletIds: ['o1'],
      effectivePropertyIds: [],
      effectiveChainIds: [],
      effectiveRole: role as never,
      grants: [],
      roleForChain: () => undefined,
      roleForProperty: () => undefined,
      roleForOutlet: () => role as never,
    },
  } as unknown as RequestWithAccess;
}

describe('ItemImagesService', () => {
  function buildService(item = fixtureItem(), images: ItemImage[] = []) {
    const itemRepository: Partial<ItemRepository> = {
      findById: jest.fn().mockResolvedValue(item),
    };
    const itemImageRepository: Partial<ItemImageRepository> = {
      create: jest.fn().mockImplementation((data) => Promise.resolve(fixtureImage(data))),
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve(images.find((i) => i.id === id) ?? null)),
      findByItemId: jest.fn().mockResolvedValue(images),
      findOldestOtherForItem: jest.fn().mockResolvedValue(null),
      setPrimary: jest.fn().mockImplementation((id, isPrimary) => Promise.resolve(fixtureImage({ id, isPrimary }))),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const storageRepository: Partial<StorageRepository> = {
      save: jest.fn().mockResolvedValue({ url: '/uploads/items/i1/new.jpg' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ItemImagesService(
      itemRepository as ItemRepository,
      itemImageRepository as ItemImageRepository,
      storageRepository as StorageRepository,
    );
    return { service, itemRepository, itemImageRepository, storageRepository };
  }

  const file = { buffer: Buffer.from('x'), mimetype: 'image/png', originalName: 'a.png' };

  describe('upload', () => {
    it('AC: the first image uploaded for an item is automatically primary', async () => {
      const { service, itemImageRepository } = buildService(fixtureItem(), []);
      await service.upload(fixtureRequest(), 'i1', file);
      expect(itemImageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: true, sortOrder: 0 }),
      );
    });

    it('subsequent uploads do not become primary', async () => {
      const { service, itemImageRepository } = buildService(fixtureItem(), [fixtureImage({ isPrimary: true })]);
      await service.upload(fixtureRequest(), 'i1', file);
      expect(itemImageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: false, sortOrder: 1 }),
      );
    });

    it('rejects upload for a role not permitted to mutate items', async () => {
      const { service } = buildService();
      await expect(service.upload(fixtureRequest('STORE_STAFF'), 'i1', file)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException for a missing item', async () => {
      const { service, itemRepository } = buildService();
      (itemRepository.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.upload(fixtureRequest(), 'missing', file)).rejects.toThrow(NotFoundException);
    });
  });

  describe('setPrimary', () => {
    it('unsets the previous primary before setting the new one', async () => {
      const oldPrimary = fixtureImage({ id: 'old', isPrimary: true });
      const target = fixtureImage({ id: 'new', isPrimary: false });
      const { service, itemImageRepository } = buildService(fixtureItem(), [oldPrimary, target]);

      await service.setPrimary(fixtureRequest(), 'i1', 'new');

      expect(itemImageRepository.setPrimary).toHaveBeenCalledWith('old', false);
      expect(itemImageRepository.setPrimary).toHaveBeenCalledWith('new', true);
    });

    it('is a no-op when the target is already primary', async () => {
      const target = fixtureImage({ id: 'img1', isPrimary: true });
      const { service, itemImageRepository } = buildService(fixtureItem(), [target]);

      await service.setPrimary(fixtureRequest(), 'i1', 'img1');

      expect(itemImageRepository.setPrimary).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an image not belonging to this item', async () => {
      const other = fixtureImage({ id: 'img2', itemId: 'other-item' });
      const { service } = buildService(fixtureItem(), [other]);
      await expect(service.setPrimary(fixtureRequest(), 'i1', 'img2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('AC: deleting the primary image promotes the next-oldest remaining image', async () => {
      const primary = fixtureImage({ id: 'primary', isPrimary: true });
      const { service, itemImageRepository, storageRepository } = buildService(fixtureItem(), [primary]);
      const nextOldest = fixtureImage({ id: 'next', isPrimary: false });
      (itemImageRepository.findOldestOtherForItem as jest.Mock).mockResolvedValue(nextOldest);

      await service.delete(fixtureRequest(), 'i1', 'primary');

      expect(itemImageRepository.delete).toHaveBeenCalledWith('primary');
      expect(storageRepository.delete).toHaveBeenCalledWith(primary.url);
      expect(itemImageRepository.setPrimary).toHaveBeenCalledWith('next', true);
    });

    it('does not attempt promotion when the deleted image was not primary', async () => {
      const nonPrimary = fixtureImage({ id: 'img1', isPrimary: false });
      const { service, itemImageRepository } = buildService(fixtureItem(), [nonPrimary]);

      await service.delete(fixtureRequest(), 'i1', 'img1');

      expect(itemImageRepository.findOldestOtherForItem).not.toHaveBeenCalled();
      expect(itemImageRepository.setPrimary).not.toHaveBeenCalled();
    });

    it('does not attempt promotion when no other images remain', async () => {
      const primary = fixtureImage({ id: 'primary', isPrimary: true });
      const { service, itemImageRepository } = buildService(fixtureItem(), [primary]);
      (itemImageRepository.findOldestOtherForItem as jest.Mock).mockResolvedValue(null);

      await service.delete(fixtureRequest(), 'i1', 'primary');

      expect(itemImageRepository.setPrimary).not.toHaveBeenCalled();
    });
  });
});
