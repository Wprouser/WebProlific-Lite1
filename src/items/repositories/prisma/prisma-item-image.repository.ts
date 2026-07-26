import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ItemImage } from '../../domain/item-image.entity';
import { CreateItemImageInput, ItemImageRepository } from '../item-image.repository';

@Injectable()
export class PrismaItemImageRepository implements ItemImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateItemImageInput): Promise<ItemImage> {
    return this.prisma.itemImage.create({ data });
  }

  async findById(id: string): Promise<ItemImage | null> {
    return this.prisma.itemImage.findUnique({ where: { id } });
  }

  async findByItemId(itemId: string): Promise<ItemImage[]> {
    return this.prisma.itemImage.findMany({
      where: { itemId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOldestOtherForItem(itemId: string, excludeId: string): Promise<ItemImage | null> {
    return this.prisma.itemImage.findFirst({
      where: { itemId, id: { not: excludeId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setPrimary(id: string, isPrimary: boolean): Promise<ItemImage> {
    return this.prisma.itemImage.update({ where: { id }, data: { isPrimary } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.itemImage.delete({ where: { id } });
  }
}
