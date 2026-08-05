import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RecipesService } from '../services/recipes.service';
import { RecipeCostService } from '../services/recipe-cost.service';
import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { CreateRecipeDto } from '../dto/create-recipe.dto';
import { QueryMenuItemsDto } from '../dto/query-menu-items.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

// No `@Roles()`/`@ResourceScope()` — FR-05's endpoints are flat (no
// /outlets/:outletId/menu-items nesting), same reasoning as
// ItemsController/SuppliersController; authorization is enforced inside
// RecipesService via assertOutletAccess once the outletId is resolved from
// the loaded menu item or the request body.
@Controller('menu-items')
export class MenuItemsController {
  constructor(
    private readonly recipesService: RecipesService,
    private readonly recipeCostService: RecipeCostService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  async create(@Req() request: RequestWithAccess, @Body() dto: CreateMenuItemDto) {
    const menuItem = await this.recipesService.createMenuItem(request, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_MENU_ITEM',
      entityType: 'MenuItem',
      entityId: menuItem.id,
      outletId: menuItem.outletId,
      after: menuItem,
    });
    return menuItem;
  }

  // Both read routes carry the `needsYield` flag, so the "Needs yield" badge
  // is available wherever a menu item is rendered without the screen having
  // to ask a second endpoint per row.
  //
  // `?subRecipeCandidates=true` reshapes the response into the picker's
  // narrower form rather than being a filter on the same rows: a candidate is
  // defined by its *recipe* (id, version, yield), which a MenuItem row has no
  // place to carry.
  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QueryMenuItemsDto) {
    if (query.subRecipeCandidates) {
      return this.recipesService.listSubRecipeCandidates(request, query, query.excludeMenuItemId);
    }
    return this.recipesService.listMenuItemsWithYieldStatus(request, query);
  }

  /** FR-05 Screens: the "Used In" tab — every current recipe consuming this
   * one, and whether it is pinned to a stale version of it. */
  @Get(':id/used-in')
  usedIn(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.recipesService.getUsedIn(request, id);
  }

  @Get(':id')
  findOne(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.recipesService.getMenuItemWithYieldStatus(request, id);
  }

  @Patch(':id')
  async update(
    @Req() request: RequestWithAccess,
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    const before = await this.recipesService.getMenuItem(request, id);
    const after = await this.recipesService.updateMenuItem(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_MENU_ITEM',
      entityType: 'MenuItem',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Patch(':id/activate')
  async activate(@Req() request: RequestWithAccess, @Param('id') id: string) {
    const before = await this.recipesService.getMenuItem(request, id);
    const after = await this.recipesService.activateMenuItem(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_MENU_ITEM',
      entityType: 'MenuItem',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Patch(':id/deactivate')
  async deactivate(@Req() request: RequestWithAccess, @Param('id') id: string) {
    const before = await this.recipesService.getMenuItem(request, id);
    const after = await this.recipesService.deactivateMenuItem(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_MENU_ITEM',
      entityType: 'MenuItem',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  // ------------------------------------------------------------------ recipes

  @Post(':id/recipes')
  async createRecipe(
    @Req() request: RequestWithAccess,
    @Param('id') id: string,
    @Body() dto: CreateRecipeDto,
  ) {
    const recipe = await this.recipesService.createRecipe(request, id, dto);
    const menuItem = await this.recipesService.getMenuItem(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_RECIPE',
      entityType: 'Recipe',
      entityId: recipe.id,
      outletId: menuItem.outletId,
      after: recipe,
    });
    return recipe;
  }

  @Get(':id/recipes/current')
  currentRecipe(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.recipesService.getCurrentRecipe(request, id);
  }

  @Get(':id/recipes/history')
  recipeHistory(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.recipesService.getRecipeHistory(request, id);
  }

  /**
   * `?version=` isn't in the spec's endpoint table, which describes only
   * "computed recipe cost from current ingredient prices". Added because
   * versioning is pointless without a way to cost a specific past version —
   * FR-06's Sale stores `recipeVersionUsed` precisely so that lookup can
   * happen. Omitting it costs the current version, matching the spec default.
   */
  @Get(':id/cost')
  async cost(
    @Req() request: RequestWithAccess,
    @Param('id') id: string,
    @Query('version') version?: string,
  ) {
    // Access check first — costRecipeVersion works off menuItemId alone and
    // has no request context of its own.
    await this.recipesService.getMenuItem(request, id);
    return this.recipeCostService.costRecipeVersion(
      id,
      version === undefined ? undefined : Number(version),
    );
  }
}
