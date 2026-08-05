import { Injectable } from '@nestjs/common';
import { MenuItem as PrismaMenuItem, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MenuItem } from '../../domain/menu-item.entity';
import {
  CreateMenuItemInput,
  MenuItemFilters,
  MenuItemRepository,
  UpdateMenuItemInput,
} from '../menu-item.repository';

function toDomain(row: PrismaMenuItem): MenuItem {
  return { ...row };
}

@Injectable()
export class PrismaMenuItemRepository implements MenuItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateMenuItemInput): Promise<MenuItem> {
    return toDomain(await this.prisma.menuItem.create({ data }));
  }

  async findById(id: string): Promise<MenuItem | null> {
    const row = await this.prisma.menuItem.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByOutletAndName(outletId: string, name: string): Promise<MenuItem | null> {
    const row = await this.prisma.menuItem.findUnique({
      where: { outletId_name: { outletId, name } },
    });
    return row ? toDomain(row) : null;
  }

  async update(id: string, data: UpdateMenuItemInput): Promise<MenuItem> {
    return toDomain(await this.prisma.menuItem.update({ where: { id }, data }));
  }

  async findScoped(filters: MenuItemFilters): Promise<MenuItem[]> {
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const where: Prisma.MenuItemWhereInput = {
      outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.search && { name: { contains: filters.search } }),
    };

    const rows = await this.prisma.menuItem.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map(toDomain);
  }

  async findIdsNeedingYield(menuItemIds: string[]): Promise<string[]> {
    if (menuItemIds.length === 0) return [];

    const recipes = await this.prisma.recipe.findMany({
      where: {
        menuItemId: { in: menuItemIds },
        yieldQuantity: null,
        // `some: {}` is "referenced by at least one recipe line" — the part
        // that separates a legitimately yield-less dish recipe from one
        // another recipe actually consumes as an ingredient.
        usedAsSubRecipeIn: { some: {} },
      },
      select: { menuItemId: true },
      distinct: ['menuItemId'],
    });
    return recipes.map((recipe) => recipe.menuItemId);
  }
}
