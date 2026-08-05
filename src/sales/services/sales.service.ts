import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SALE_REPOSITORY } from '../repositories/tokens';
import { SaleRepository } from '../repositories/sale.repository';
import { MENU_ITEM_REPOSITORY } from '../../recipes/repositories/tokens';
import { MenuItemRepository } from '../../recipes/repositories/menu-item.repository';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { Role } from '../../tenancy/constants/enums';
import { SALES_MUTATE_ROLES } from '../constants/enums';
import { RecordSaleResult, SaleDeductionService } from './sale-deduction.service';
import { PosSaleDto } from '../dto/pos-sale.dto';
import { PosVoidDto } from '../dto/pos-void.dto';
import { CreateManualSaleDto } from '../dto/create-manual-sale.dto';
import { QuerySalesDto } from '../dto/query-sales.dto';
import { SaleWithMenuItem, UnmappedMenuItem } from '../domain/sale.entity';

@Injectable()
export class SalesService {
  constructor(
    @Inject(SALE_REPOSITORY) private readonly saleRepository: SaleRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    private readonly saleDeductionService: SaleDeductionService,
  ) {}

  /**
   * Model 1 — the live POS webhook. Authenticated by HMAC at the controller,
   * so there is no request/user here and nothing to authorize against: the
   * menu item's own outlet is the scope.
   */
  async recordWebhookSale(dto: PosSaleDto): Promise<RecordSaleResult> {
    const menuItem = await this.menuItemRepository.findById(dto.menuItemId);
    if (!menuItem) throw new NotFoundException(`Menu item ${dto.menuItemId} not found`);

    return this.saleDeductionService.recordSale({
      outletId: menuItem.outletId,
      menuItemId: dto.menuItemId,
      quantitySold: dto.quantitySold,
      posReferenceId: dto.posReferenceId,
      sourceType: 'WEBHOOK',
      saleTimestamp: new Date(dto.timestamp),
    });
  }

  /**
   * Void/refund, by the POS's own reference rather than our id — the POS
   * doesn't know our ids. Works identically for batch-imported and manual
   * sales, whose generated posReferenceIds are equally addressable.
   */
  async voidByPosReference(dto: PosVoidDto): Promise<{ voided: boolean; reversedCount: number }> {
    const sale = await this.saleRepository.findByPosReferenceId(dto.posReferenceId);
    if (!sale) throw new NotFoundException(`No sale found for reference ${dto.posReferenceId}`);

    // Idempotent, for the same reason the sale path is: a POS that retries a
    // void must not reverse the stock twice.
    if (sale.isVoid) return { voided: false, reversedCount: 0 };

    const { reversedCount } = await this.saleDeductionService.voidSale(sale);
    return { voided: true, reversedCount };
  }

  /** Model 3 — hand-entered single sale, for outlets with no POS feed. */
  async createManualSale(request: RequestWithAccess, dto: CreateManualSaleDto): Promise<RecordSaleResult> {
    const menuItem = await this.menuItemRepository.findById(dto.menuItemId);
    if (!menuItem) throw new NotFoundException(`Menu item ${dto.menuItemId} not found`);
    assertOutletAccess(request, menuItem.outletId, [...SALES_MUTATE_ROLES] as Role[]);

    if (Number(dto.quantitySold) <= 0) {
      throw new BadRequestException('quantitySold must be greater than 0');
    }

    return this.saleDeductionService.recordSale({
      outletId: menuItem.outletId,
      menuItemId: dto.menuItemId,
      quantitySold: dto.quantitySold,
      // Manual entries have no external reference to be idempotent against,
      // so one is generated. Two identical hand-entered sales are two real
      // sales, not a duplicate — unlike a retried webhook.
      posReferenceId: `manual:${randomUUID()}`,
      sourceType: 'MANUAL',
      saleTimestamp: dto.saleTimestamp ? new Date(dto.saleTimestamp) : new Date(),
    });
  }

  async list(request: RequestWithAccess, query: QuerySalesDto): Promise<SaleWithMenuItem[]> {
    return this.saleRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      menuItemId: query.menuItemId,
      sourceType: query.sourceType,
      unmappedOnly: query.unmappedOnly,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }

  /** The Unmapped Items worklist: sold, but nothing was deducted. */
  async listUnmapped(request: RequestWithAccess, outletId?: string): Promise<UnmappedMenuItem[]> {
    return this.saleRepository.findUnmappedMenuItems(
      request.effectiveAccess!.effectiveOutletIds,
      outletId,
    );
  }
}
