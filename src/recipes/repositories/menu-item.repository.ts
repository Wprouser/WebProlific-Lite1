import { MenuItem } from '../domain/menu-item.entity';

export interface CreateMenuItemInput {
  outletId: string;
  name: string;
}

export interface UpdateMenuItemInput {
  name?: string;
  isActive?: boolean;
}

export interface MenuItemFilters {
  accessibleOutletIds: string[];
  outletId?: string;
  isActive?: boolean;
  search?: string;
}

export abstract class MenuItemRepository {
  abstract create(data: CreateMenuItemInput): Promise<MenuItem>;
  abstract findById(id: string): Promise<MenuItem | null>;
  abstract findByOutletAndName(outletId: string, name: string): Promise<MenuItem | null>;
  abstract update(id: string, data: UpdateMenuItemInput): Promise<MenuItem>;
  abstract findScoped(filters: MenuItemFilters): Promise<MenuItem[]>;

  /**
   * Which of these menu items own a recipe version that has no yield *and*
   * is referenced as a sub-recipe somewhere — i.e. the ones that cause an
   * imprecise, legacy-batch-multiplier deduction. Drives FR-06's "Needs
   * yield" badge.
   *
   * Both halves of the condition matter. A top-level dish recipe legitimately
   * has no yield (it's "one portion"), so flagging every yield-less recipe
   * would mark almost everything and mean nothing. And it looks at *all*
   * versions, not just the current one: a parent recipe pins a specific
   * version, so an old yield-less version can still be the one a sale
   * deducts through even after the current version gains a yield.
   */
  abstract findIdsNeedingYield(menuItemIds: string[]): Promise<string[]>;
}
