import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUPPLIER_REPOSITORY, SUPPLIER_PRICE_HISTORY_REPOSITORY } from '../repositories/tokens';
import { SupplierRepository } from '../repositories/supplier.repository';
import { SupplierPriceHistoryRepository } from '../repositories/supplier-price-history.repository';
import { Supplier } from '../domain/supplier.entity';
import { SupplierPriceHistory } from '../domain/supplier-price-history.entity';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { QuerySuppliersDto } from '../dto/query-suppliers.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { CurrenciesService } from '../../currencies/services/currencies.service';

// Matches Item/Category's own role set (procurement/operational master
// data), not Tax Rate/Currency's narrower CHAIN_OWNER/PROPERTY_MANAGER —
// outlet staff routinely need to maintain their own supplier directory.
const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'] as const;

export interface SupplierPerformance {
  totalGrns: number;
  onTimeRate: number | null;
  priceConsistencyScore: number | null;
}

@Injectable()
export class SuppliersService {
  constructor(
    @Inject(SUPPLIER_REPOSITORY) private readonly supplierRepository: SupplierRepository,
    @Inject(SUPPLIER_PRICE_HISTORY_REPOSITORY)
    private readonly priceHistoryRepository: SupplierPriceHistoryRepository,
    private readonly currenciesService: CurrenciesService,
  ) {}

  async create(request: RequestWithAccess, dto: CreateSupplierDto): Promise<Supplier> {
    assertOutletAccess(request, dto.outletId, [...MUTATE_ROLES]);
    if (dto.preferredCurrency) await this.currenciesService.getOrThrow(dto.preferredCurrency);

    return this.supplierRepository.create(dto);
  }

  async findById(request: RequestWithAccess, id: string): Promise<Supplier> {
    const supplier = await this.getOrThrow(id);
    assertOutletAccess(request, supplier.outletId);
    return supplier;
  }

  async update(request: RequestWithAccess, id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...MUTATE_ROLES]);
    if (dto.preferredCurrency) await this.currenciesService.getOrThrow(dto.preferredCurrency);

    return this.supplierRepository.update(id, dto);
  }

  async deactivate(request: RequestWithAccess, id: string): Promise<Supplier> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...MUTATE_ROLES]);
    await this.assertNoOpenPurchaseOrders(id);
    return this.supplierRepository.update(id, { isActive: false });
  }

  /**
   * Spec's business rule: DELETE /suppliers/:id -> 409 if any
   * PurchaseOrder.status NOT IN [Closed, Cancelled, Rejected] references
   * it. PurchaseOrder doesn't exist yet — FR-04 isn't built — so this is a
   * no-op today, same pattern as ItemsService.assertNoOpenPurchaseOrders.
   */
  private async assertNoOpenPurchaseOrders(_supplierId: string): Promise<void> {
    return;
  }

  list(request: RequestWithAccess, query: QuerySuppliersDto): Promise<Supplier[]> {
    return this.supplierRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      search: query.search,
    });
  }

  async priceHistory(request: RequestWithAccess, id: string, itemId?: string): Promise<SupplierPriceHistory[]> {
    const supplier = await this.getOrThrow(id);
    assertOutletAccess(request, supplier.outletId);
    return this.priceHistoryRepository.findScoped({ supplierId: id, itemId });
  }

  /**
   * Spec's baseline formula: onTimeRate = COUNT(GRNs received on/before PO
   * expectedDeliveryDate) / COUNT(total GRNs) — computed from real GRN data
   * once FR-04 exists. Until then there are zero GRNs by definition, so
   * this returns a safe, honestly-empty baseline rather than a fabricated
   * number.
   */
  async performance(request: RequestWithAccess, id: string): Promise<SupplierPerformance> {
    const supplier = await this.getOrThrow(id);
    assertOutletAccess(request, supplier.outletId);
    return { totalGrns: 0, onTimeRate: null, priceConsistencyScore: null };
  }

  private async getOrThrow(id: string): Promise<Supplier> {
    const supplier = await this.supplierRepository.findById(id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }
}
