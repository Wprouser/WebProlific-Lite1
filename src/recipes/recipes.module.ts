import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ItemsModule } from '../items/items.module';
import { MenuItemsController } from './controllers/menu-items.controller';
import { RecipesService } from './services/recipes.service';
import { RecipeCostService } from './services/recipe-cost.service';
import { MENU_ITEM_REPOSITORY, RECIPE_REPOSITORY } from './repositories/tokens';
import { PrismaMenuItemRepository } from './repositories/prisma/prisma-menu-item.repository';
import { PrismaRecipeRepository } from './repositories/prisma/prisma-recipe.repository';

@Module({
  // ItemsModule for ITEM_REPOSITORY — recipes validate that every ingredient
  // exists and belongs to the same outlet, and cost them from Item.costPrice.
  imports: [RbacModule, ItemsModule],
  controllers: [MenuItemsController],
  providers: [
    RecipesService,
    RecipeCostService,
    { provide: MENU_ITEM_REPOSITORY, useClass: PrismaMenuItemRepository },
    { provide: RECIPE_REPOSITORY, useClass: PrismaRecipeRepository },
  ],
  // FR-06 (POS auto-deduction) will need both: RECIPE_REPOSITORY to resolve
  // the version a sale was made against, and RecipeCostService's flattening
  // to turn one sale into per-item stock deductions.
  exports: [MENU_ITEM_REPOSITORY, RECIPE_REPOSITORY, RecipeCostService],
})
export class RecipesModule {}
