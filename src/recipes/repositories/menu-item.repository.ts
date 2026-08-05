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
}
