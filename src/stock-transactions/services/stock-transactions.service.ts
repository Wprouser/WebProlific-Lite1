import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { STOCK_TRANSACTION_REPOSITORY } from '../repositories/tokens';
import { StockTransactionRepository } from '../repositories/stock-transaction.repository';
import { StockTransaction } from '../domain/stock-transaction.entity';
import { CreateStockTransactionDto } from '../dto/create-stock-transaction.dto';
import { QueryStockTransactionsDto } from '../dto/query-stock-transactions.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { Role } from '../../tenancy/constants/enums';
import { assertOutletAccess } from '../../tenancy/access.util';
import { AuditLogService } from '../../rbac/services/audit-log.service';
import { ITEM_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { CHEF_ALLOWED_TYPES, FORCE_OVERRIDE_ROLES, ReasonCode, ReferenceType, TransactionType } from '../constants/enums';
import { ITEM_STOCK_CHANGED_EVENT, ItemStockChangedEvent } from '../events/stock-changed.event';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';

/**
 * FR-06: a stock movement with no human behind it. Deliberately a separate
 * input type from CreateStockTransactionDto — there is no request, no role
 * to resolve, and no forceOverride flag to honour, so reusing that DTO would
 * mean carrying three fields that can never be meaningfully set.
 */
export interface SystemStockMovementInput {
  itemId: string;
  type: TransactionType;
  quantity: string;
  referenceType: ReferenceType;
  referenceId: string;
  /** i18n message key for the activity feed, per FR-15/FR-18. */
  descriptionKey: string;
  metadata?: Record<string, unknown>;
}

export interface SystemStockMovementResult {
  transaction: StockTransaction;
  /** True when the movement drove the balance below zero — recorded, never
   * refused, but worth surfacing to the caller so it can warn. */
  wentNegative: boolean;
}

@Injectable()
export class StockTransactionsService {
  constructor(
    @Inject(STOCK_TRANSACTION_REPOSITORY) private readonly stockTransactionRepository: StockTransactionRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    private readonly auditLogService: AuditLogService,
    private readonly activityBus: ActivityBus,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(request: RequestWithAccess, dto: CreateStockTransactionDto): Promise<StockTransaction> {
    const item = await this.itemRepository.findById(dto.itemId);
    if (!item) throw new NotFoundException(`Item ${dto.itemId} not found`);

    // FR-11 matrix: all 5 roles may create stock transactions (unlike
    // Item mutations, which are manager-only) — just verify some access
    // to this outlet exists, no role list to pass.
    assertOutletAccess(request, item.outletId);
    const role = request.effectiveAccess!.roleForOutlet(item.outletId)!;

    this.assertQuantityPositive(dto.quantity);
    this.assertReasonCode(dto.type, dto.reasonCode);
    this.assertChefTypeRestriction(role, dto.type);

    // Spec: "unless requester has role IN [...] AND passes forceOverride:
    // true" — both conditions gate it. A STORE_STAFF/CHEF setting
    // forceOverride has no effect; the negative-balance check still runs.
    const allowNegativeBalance = Boolean(dto.forceOverride) && (FORCE_OVERRIDE_ROLES as readonly string[]).includes(role);

    const result = await this.stockTransactionRepository.createWithBalanceUpdate({
      outletId: item.outletId,
      itemId: dto.itemId,
      type: dto.type,
      quantity: dto.quantity,
      referenceType: dto.referenceType ?? null,
      referenceId: dto.referenceId ?? null,
      reasonCode: dto.reasonCode ?? null,
      performedById: request.user!.id,
      allowNegativeBalance,
    });

    if (!result.ok) {
      throw new BadRequestException('Insufficient stock for this transaction');
    }

    // HIGH only when the override was actually exercised (balance really
    // did go negative) — not just because forceOverride was passed.
    const overrideExercised = allowNegativeBalance && Number(result.transaction.balanceAfter) < 0;

    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_STOCK_TRANSACTION',
      entityType: 'StockTransaction',
      entityId: result.transaction.id,
      outletId: item.outletId,
      after: result.transaction,
      severity: overrideExercised ? 'HIGH' : undefined,
    });

    const event: ItemStockChangedEvent = {
      itemId: item.id,
      outletId: item.outletId,
      currentStock: result.item.currentStock,
      minStock: result.item.minStock,
    };
    this.eventEmitter.emit(ITEM_STOCK_CHANGED_EVENT, event);

    return result.transaction;
  }

  /**
   * FR-06's machine path into the same ledger. Three deliberate differences
   * from `create()` above, each following from "a POS sale already happened
   * — the only question is whether we record it":
   *
   * 1. No `assertOutletAccess` / role check. A HMAC-signed webhook has no
   *    user to authorize; the signature *is* the authorization, checked at
   *    the controller boundary before anything reaches here.
   * 2. `allowNegativeBalance` is always true. Refusing to record a sale
   *    because the books say there wasn't enough stock makes the books
   *    *more* wrong, not less — the shortfall is real and the negative
   *    balance is the honest record of it. Reported back via `wentNegative`
   *    so the caller can raise a warning instead of an error.
   * 3. Logs through `ActivityBus` directly rather than `AuditLogService`.
   *    FR-11's AuditLog answers "which user did this" and its `userId` is a
   *    required FK — a meaningless question for a machine. ActivityLog and
   *    TransactionLog both allow a null actor precisely for this case.
   */
  async createSystem(input: SystemStockMovementInput): Promise<SystemStockMovementResult> {
    const item = await this.itemRepository.findById(input.itemId);
    if (!item) throw new NotFoundException(`Item ${input.itemId} not found`);

    this.assertQuantityPositive(input.quantity);

    const result = await this.stockTransactionRepository.createWithBalanceUpdate({
      outletId: item.outletId,
      itemId: input.itemId,
      type: input.type,
      quantity: input.quantity,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reasonCode: null,
      performedById: null,
      allowNegativeBalance: true,
    });

    // Unreachable with allowNegativeBalance: true — the repository only
    // returns !ok for INSUFFICIENT_STOCK, which that flag suppresses. Kept
    // as a typed guard so a future failure reason can't be silently ignored.
    if (!result.ok) {
      throw new BadRequestException('Insufficient stock for this transaction');
    }

    await this.activityBus.record({
      category: 'STOCK',
      action: 'CREATE_STOCK_TRANSACTION',
      entityType: 'StockTransaction',
      entityId: result.transaction.id,
      outletId: item.outletId,
      descriptionKey: input.descriptionKey,
      metadata: input.metadata,
      entityChange: {
        outletId: item.outletId,
        entityCategory: 'TRANSACTIONAL',
        entityType: 'StockTransaction',
        entityId: result.transaction.id,
        operation: 'CREATE',
        entries: [{ newValue: JSON.stringify(result.transaction) }],
      },
    });

    const event: ItemStockChangedEvent = {
      itemId: item.id,
      outletId: item.outletId,
      currentStock: result.item.currentStock,
      minStock: result.item.minStock,
    };
    this.eventEmitter.emit(ITEM_STOCK_CHANGED_EVENT, event);

    return { transaction: result.transaction, wentNegative: Number(result.transaction.balanceAfter) < 0 };
  }

  /** FR-06 void: the movements written for one reference, oldest first. */
  async findByReference(referenceType: ReferenceType, referenceId: string): Promise<StockTransaction[]> {
    return this.stockTransactionRepository.findByReference(referenceType, referenceId);
  }

  async findById(request: RequestWithAccess, id: string): Promise<StockTransaction> {
    const transaction = await this.getOrThrow(id);
    assertOutletAccess(request, transaction.outletId);
    return transaction;
  }

  async list(request: RequestWithAccess, query: QueryStockTransactionsDto): Promise<StockTransaction[]> {
    return this.stockTransactionRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      itemId: query.itemId,
      type: query.type,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }

  private assertQuantityPositive(quantity: string): void {
    if (Number(quantity) <= 0) {
      throw new BadRequestException('quantity must be greater than 0');
    }
  }

  private assertReasonCode(type: TransactionType, reasonCode?: ReasonCode): void {
    if (type === 'WASTAGE_OUT' && !reasonCode) {
      throw new BadRequestException('reasonCode is required for WASTAGE_OUT transactions');
    }
    if (type !== 'WASTAGE_OUT' && reasonCode) {
      throw new BadRequestException('reasonCode must only be set for WASTAGE_OUT transactions');
    }
  }

  private assertChefTypeRestriction(role: Role, type: TransactionType): void {
    if (role === 'CHEF' && !CHEF_ALLOWED_TYPES.includes(type)) {
      throw new ForbiddenException(`CHEF role can only create ${CHEF_ALLOWED_TYPES.join('/')} transactions`);
    }
  }

  private async getOrThrow(id: string): Promise<StockTransaction> {
    const transaction = await this.stockTransactionRepository.findById(id);
    if (!transaction) throw new NotFoundException(`StockTransaction ${id} not found`);
    return transaction;
  }
}
