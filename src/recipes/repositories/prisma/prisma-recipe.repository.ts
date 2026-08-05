import { Injectable } from '@nestjs/common';
import { Prisma, Recipe as PrismaRecipe, RecipeLine as PrismaRecipeLine } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Recipe, RecipeLine } from '../../domain/recipe.entity';
import { CreateRecipeInput, RecipeRepository } from '../recipe.repository';

function lineToDomain(row: PrismaRecipeLine): RecipeLine {
  return {
    id: row.id,
    recipeId: row.recipeId,
    itemId: row.itemId,
    subRecipeId: row.subRecipeId,
    // Prisma Decimal -> string, never number: Decimal(10,4) values like
    // 0.0025 must survive the boundary exactly.
    quantity: row.quantity.toString(),
    quantityUnitId: row.quantityUnitId,
  };
}

function toDomain(row: PrismaRecipe & { lines: PrismaRecipeLine[] }): Recipe {
  return {
    id: row.id,
    menuItemId: row.menuItemId,
    version: row.version,
    isCurrent: row.isCurrent,
    createdAt: row.createdAt,
    yieldQuantity: row.yieldQuantity === null ? null : row.yieldQuantity.toString(),
    yieldUnitId: row.yieldUnitId,
    lines: row.lines.map(lineToDomain),
  };
}

@Injectable()
export class PrismaRecipeRepository implements RecipeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(data: CreateRecipeInput): Promise<Recipe> {
    // One transaction: demoting the old current version and inserting the new
    // one must not be separable, or a crash between them leaves a menu item
    // with either two current recipes or none.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.recipe.updateMany({
        where: { menuItemId: data.menuItemId, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.recipe.create({
        data: {
          menuItemId: data.menuItemId,
          version: data.version,
          isCurrent: true,
          yieldQuantity:
            data.yieldQuantity == null ? null : new Prisma.Decimal(data.yieldQuantity),
          yieldUnitId: data.yieldUnitId ?? null,
          lines: {
            create: data.lines.map((line) => ({
              itemId: line.itemId ?? null,
              subRecipeId: line.subRecipeId ?? null,
              quantity: new Prisma.Decimal(line.quantity),
              quantityUnitId: line.quantityUnitId ?? null,
            })),
          },
        },
        include: { lines: true },
      });
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<Recipe | null> {
    const row = await this.prisma.recipe.findUnique({ where: { id }, include: { lines: true } });
    return row ? toDomain(row) : null;
  }

  async findCurrentByMenuItemId(menuItemId: string): Promise<Recipe | null> {
    const row = await this.prisma.recipe.findFirst({
      where: { menuItemId, isCurrent: true },
      include: { lines: true },
    });
    return row ? toDomain(row) : null;
  }

  async findAllByMenuItemId(menuItemId: string): Promise<Recipe[]> {
    const rows = await this.prisma.recipe.findMany({
      where: { menuItemId },
      include: { lines: true },
      orderBy: { version: 'desc' },
    });
    return rows.map(toDomain);
  }

  async findByMenuItemIdAndVersion(menuItemId: string, version: number): Promise<Recipe | null> {
    const row = await this.prisma.recipe.findUnique({
      where: { menuItemId_version: { menuItemId, version } },
      include: { lines: true },
    });
    return row ? toDomain(row) : null;
  }

  async maxVersionForMenuItem(menuItemId: string): Promise<number> {
    const result = await this.prisma.recipe.aggregate({
      where: { menuItemId },
      _max: { version: true },
    });
    return result._max.version ?? 0;
  }

  async findLinesForRecipeIds(recipeIds: string[]): Promise<Map<string, RecipeLine[]>> {
    const byRecipe = new Map<string, RecipeLine[]>();
    if (recipeIds.length === 0) return byRecipe;

    // Seed every requested id, so a recipe that genuinely has zero lines is
    // distinguishable from one that doesn't exist (the tree walk treats a
    // missing key as a dangling reference).
    const existing = await this.prisma.recipe.findMany({
      where: { id: { in: recipeIds } },
      select: { id: true },
    });
    for (const row of existing) byRecipe.set(row.id, []);

    const lines = await this.prisma.recipeLine.findMany({
      where: { recipeId: { in: recipeIds } },
    });
    for (const line of lines) {
      byRecipe.get(line.recipeId)?.push(lineToDomain(line));
    }
    return byRecipe;
  }

  async findMenuItemIdsForRecipeIds(recipeIds: string[]): Promise<Map<string, string>> {
    if (recipeIds.length === 0) return new Map();
    const rows = await this.prisma.recipe.findMany({
      where: { id: { in: recipeIds } },
      select: { id: true, menuItemId: true },
    });
    return new Map(rows.map((row) => [row.id, row.menuItemId]));
  }
}
