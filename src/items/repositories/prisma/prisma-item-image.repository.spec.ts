import { PrismaItemImageRepository } from './prisma-item-image.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
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

describe('PrismaItemImageRepository', () => {
  function buildRepository() {
    const itemImage = {
      create: jest.fn().mockImplementation(({ data }: any) => fixtureRow(data)),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn().mockImplementation(({ where, data }: any) => fixtureRow({ id: where.id, ...data })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = { itemImage };
    const repository = new PrismaItemImageRepository(prisma as any);
    return { repository, itemImage };
  }

  it('create passes data straight through to prisma.itemImage.create', async () => {
    const { repository, itemImage } = buildRepository();
    await repository.create({ itemId: 'i1', url: '/x.jpg', isPrimary: true, sortOrder: 0 });
    expect(itemImage.create).toHaveBeenCalledWith({
      data: { itemId: 'i1', url: '/x.jpg', isPrimary: true, sortOrder: 0 },
    });
  });

  it('findByItemId orders by sortOrder then createdAt', async () => {
    const { repository, itemImage } = buildRepository();
    await repository.findByItemId('i1');
    expect(itemImage.findMany).toHaveBeenCalledWith({
      where: { itemId: 'i1' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('findOldestOtherForItem excludes the given id and orders by createdAt ascending', async () => {
    const { repository, itemImage } = buildRepository();
    await repository.findOldestOtherForItem('i1', 'exclude-me');
    expect(itemImage.findFirst).toHaveBeenCalledWith({
      where: { itemId: 'i1', id: { not: 'exclude-me' } },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('setPrimary updates only the isPrimary flag', async () => {
    const { repository, itemImage } = buildRepository();
    await repository.setPrimary('img1', true);
    expect(itemImage.update).toHaveBeenCalledWith({ where: { id: 'img1' }, data: { isPrimary: true } });
  });

  it('delete removes the row by id', async () => {
    const { repository, itemImage } = buildRepository();
    await repository.delete('img1');
    expect(itemImage.delete).toHaveBeenCalledWith({ where: { id: 'img1' } });
  });
});
