import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { StorageModule } from '../storage/storage.module';
import { CategoriesController } from './controllers/categories.controller';
import { UnitsController } from './controllers/units.controller';
import { ItemsController } from './controllers/items.controller';
import { ItemImagesController } from './controllers/item-images.controller';
import { CategoriesService } from './services/categories.service';
import { UnitsService } from './services/units.service';
import { ItemsService } from './services/items.service';
import { ItemImagesService } from './services/item-images.service';
import { DefaultCategoriesListener } from './listeners/default-categories.listener';
import { DefaultUnitsListener } from './listeners/default-units.listener';
import {
  ITEM_REPOSITORY,
  CATEGORY_REPOSITORY,
  ITEM_IMAGE_REPOSITORY,
  UNIT_OF_MEASURE_REPOSITORY,
} from './repositories/tokens';
import { PrismaItemRepository } from './repositories/prisma/prisma-item.repository';
import { PrismaCategoryRepository } from './repositories/prisma/prisma-category.repository';
import { PrismaItemImageRepository } from './repositories/prisma/prisma-item-image.repository';
import { PrismaUnitOfMeasureRepository } from './repositories/prisma/prisma-unit-of-measure.repository';

@Module({
  imports: [RbacModule, StorageModule],
  // CategoriesController/UnitsController registered before ItemsController
  // — see CategoriesController's doc comment (GET/POST items/categories and
  // items/units must resolve before ItemsController's GET items/:id).
  controllers: [CategoriesController, UnitsController, ItemsController, ItemImagesController],
  providers: [
    ItemsService,
    CategoriesService,
    UnitsService,
    ItemImagesService,
    DefaultCategoriesListener,
    DefaultUnitsListener,
    { provide: ITEM_REPOSITORY, useClass: PrismaItemRepository },
    { provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository },
    { provide: ITEM_IMAGE_REPOSITORY, useClass: PrismaItemImageRepository },
    { provide: UNIT_OF_MEASURE_REPOSITORY, useClass: PrismaUnitOfMeasureRepository },
  ],
  // ITEM_REPOSITORY: FR-02's StockTransactionsService needs an item's
  // outletId/currentStock — reuses this rather than a second repository.
  // UNIT_OF_MEASURE_REPOSITORY: FR-04's PurchaseOrdersService/GrnService
  // need a line item's unit abbreviation for PDF generation.
  exports: [ITEM_REPOSITORY, UNIT_OF_MEASURE_REPOSITORY],
})
export class ItemsModule {}
