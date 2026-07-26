import { ItemImage } from '../domain/item-image.entity';

export interface CreateItemImageInput {
  itemId: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ItemImageRepository {
  create(data: CreateItemImageInput): Promise<ItemImage>;
  findById(id: string): Promise<ItemImage | null>;
  findByItemId(itemId: string): Promise<ItemImage[]>;
  /** Excludes `excludeId` itself — used to find candidates to promote when
   * the current primary is deleted. */
  findOldestOtherForItem(itemId: string, excludeId: string): Promise<ItemImage | null>;
  setPrimary(id: string, isPrimary: boolean): Promise<ItemImage>;
  delete(id: string): Promise<void>;
}
