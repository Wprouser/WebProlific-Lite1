import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PURCHASE_ORDER_REPOSITORY } from '../repositories/tokens';
import {
  CreatePOLineInput,
  PurchaseOrderRepository,
} from '../repositories/purchase-order.repository';
import { PurchaseOrder } from '../domain/purchase-order.entity';
import { POStatus, PO_APPROVAL_ROLES, PO_CREATE_ROLES } from '../constants/enums';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from '../dto/update-purchase-order.dto';
import { QueryPurchaseOrdersDto } from '../dto/query-purchase-orders.dto';
import { CreatePOLineDto } from '../dto/create-po-line.dto';
import { applyDocumentLineTax, convertToBaseCurrency, sumDocumentTotals } from '../lib/apply-document-tax';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { OUTLET_REPOSITORY } from '../../tenancy/repositories/tokens';
import { OutletRepository } from '../../tenancy/repositories/outlet.repository';
import { SUPPLIER_REPOSITORY } from '../../suppliers/repositories/tokens';
import { SupplierRepository } from '../../suppliers/repositories/supplier.repository';
import { CurrenciesService } from '../../currencies/services/currencies.service';
import { EXCHANGE_RATE_REPOSITORY } from '../../exchange-rates/repositories/tokens';
import { ExchangeRateRepository } from '../../exchange-rates/repositories/exchange-rate.repository';
import { TAX_RATE_REPOSITORY } from '../../tax-rates/repositories/tokens';
import { TaxRateRepository } from '../../tax-rates/repositories/tax-rate.repository';
import { TaxRate } from '../../tax-rates/domain/tax-rate.entity';
import { ITEM_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { EMAIL_PROVIDER } from '../../email/providers/tokens';
import { EmailProvider } from '../../email/providers/email.provider';
import { generateDocumentPdf } from '../../documents/lib/generate-document-pdf';
import { SendEmailDto } from '../../documents/dto/send-email.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY) private readonly poRepository: PurchaseOrderRepository,
    @Inject(OUTLET_REPOSITORY) private readonly outletRepository: OutletRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly supplierRepository: SupplierRepository,
    @Inject(EXCHANGE_RATE_REPOSITORY) private readonly exchangeRateRepository: ExchangeRateRepository,
    @Inject(TAX_RATE_REPOSITORY) private readonly taxRateRepository: TaxRateRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly currenciesService: CurrenciesService,
  ) {}

  async create(request: RequestWithAccess, dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
    assertOutletAccess(request, dto.outletId, [...PO_CREATE_ROLES]);

    const outlet = await this.getOutletOrThrow(dto.outletId);
    await this.assertSupplierBelongsToOutlet(dto.supplierId, dto.outletId);

    const currencyCode = dto.currencyCode ?? outlet.baseCurrency;
    await this.currenciesService.getOrThrow(currencyCode);
    const exchangeRateToBase = await this.resolveExchangeRateToBase(
      currencyCode,
      outlet.baseCurrency,
      dto.exchangeRateToBase,
    );
    const isTaxInclusive = dto.isTaxInclusive ?? false;
    const discountAmount = dto.discountAmount ?? '0.00';
    const otherChargesAmount = dto.otherChargesAmount ?? '0.00';

    const lines = await this.buildLines(dto.lines, isTaxInclusive);
    const totals = sumDocumentTotals(lines, discountAmount, otherChargesAmount);

    return this.poRepository.create({
      outletId: dto.outletId,
      supplierId: dto.supplierId,
      createdById: request.user!.id,
      currencyCode,
      exchangeRateToBase,
      isTaxInclusive,
      discountAmount,
      otherChargesAmount,
      expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
      ...totals,
      lines,
    });
  }

  async findById(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const po = await this.getOrThrow(id);
    assertOutletAccess(request, po.outletId);
    return po;
  }

  list(request: RequestWithAccess, query: QueryPurchaseOrdersDto): Promise<PurchaseOrder[]> {
    return this.poRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      status: query.status as POStatus | undefined,
      supplierId: query.supplierId,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }

  /**
   * Not a literal spec endpoint (the endpoint table only lists status
   * transitions), but explicitly requested as part of the "create/edit/
   * approve" workflow — DRAFT is the only status this ever applies to,
   * since editing an already-submitted PO would undermine the approval
   * step's whole point. Recomputes every line the same way create() does
   * (using whichever lines/isTaxInclusive/discount/otherCharges are now
   * effective), so a lone isTaxInclusive toggle without resending lines
   * still produces consistent totals rather than silently stale ones.
   */
  async update(request: RequestWithAccess, id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrder> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...PO_CREATE_ROLES]);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT purchase order can be edited');
    }

    const outlet = await this.getOutletOrThrow(existing.outletId);
    const supplierId = dto.supplierId ?? existing.supplierId;
    if (dto.supplierId) await this.assertSupplierBelongsToOutlet(dto.supplierId, existing.outletId);

    const currencyCode = dto.currencyCode ?? existing.currencyCode;
    if (dto.currencyCode) await this.currenciesService.getOrThrow(currencyCode);
    const exchangeRateToBase =
      dto.exchangeRateToBase ??
      (dto.currencyCode && dto.currencyCode !== existing.currencyCode
        ? await this.resolveExchangeRateToBase(currencyCode, outlet.baseCurrency, undefined)
        : existing.exchangeRateToBase);
    const isTaxInclusive = dto.isTaxInclusive ?? existing.isTaxInclusive;
    const discountAmount = dto.discountAmount ?? existing.discountAmount;
    const otherChargesAmount = dto.otherChargesAmount ?? existing.otherChargesAmount;

    const linesInput: CreatePOLineDto[] =
      dto.lines ??
      existing.lines.map((l) => ({
        itemId: l.itemId,
        orderedQty: l.orderedQty,
        expectedPrice: l.expectedPrice,
        taxRateId: l.taxRateId ?? undefined,
      }));
    const lines = await this.buildLines(linesInput, isTaxInclusive);
    const totals = sumDocumentTotals(lines, discountAmount, otherChargesAmount);

    return this.poRepository.update(id, {
      supplierId,
      currencyCode,
      exchangeRateToBase,
      isTaxInclusive,
      discountAmount,
      otherChargesAmount,
      expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
      ...totals,
      lines,
    });
  }

  async submit(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...PO_CREATE_ROLES]);
    this.assertStatus(existing, 'DRAFT', 'submitted');
    return this.poRepository.updateStatus(id, { status: 'PENDING_APPROVAL' });
  }

  /**
   * RBAC permission matrix (FR-11): "Approve PO — CHAIN_OWNER: always;
   * PROPERTY_MANAGER/OUTLET_MANAGER: only below the outlet's
   * poApprovalThreshold." The threshold comparison always converts
   * totalValue to the outlet's base currency via the PO's own snapshotted
   * exchangeRateToBase (spec's Business Logic note), so it stays consistent
   * regardless of which currency the PO was raised in.
   */
  async approve(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...PO_APPROVAL_ROLES]);
    this.assertStatus(existing, 'PENDING_APPROVAL', 'approved');

    const role = request.effectiveAccess?.roleForOutlet(existing.outletId);
    if (role !== 'CHAIN_OWNER') {
      const outlet = await this.getOutletOrThrow(existing.outletId);
      if (outlet.poApprovalThreshold !== null) {
        const totalInBase = convertToBaseCurrency(existing.totalValue, existing.exchangeRateToBase);
        if (Number(totalInBase) >= Number(outlet.poApprovalThreshold)) {
          throw new ForbiddenException(
            `This purchase order (${totalInBase} ${outlet.baseCurrency}) is at or above this outlet's approval threshold — only CHAIN_OWNER can approve it`,
          );
        }
      }
    }

    return this.poRepository.updateStatus(id, {
      status: 'APPROVED',
      approvedById: request.user!.id,
      approvedAt: new Date(),
    });
  }

  /**
   * `reason` has no column on PurchaseOrder itself (the spec's data model
   * doesn't add one) — it's captured in the audit/activity trail instead
   * (the controller passes it through to AuditLogService), which is where
   * a narrative "why" naturally belongs, not as a schema field.
   */
  async reject(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...PO_APPROVAL_ROLES]);
    this.assertStatus(existing, 'PENDING_APPROVAL', 'rejected');
    return this.poRepository.updateStatus(id, { status: 'REJECTED' });
  }

  async send(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...PO_APPROVAL_ROLES]);
    this.assertStatus(existing, 'APPROVED', 'sent to the supplier');
    return this.poRepository.updateStatus(id, { status: 'SENT_TO_SUPPLIER' });
  }

  async close(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...PO_APPROVAL_ROLES]);
    this.assertStatus(existing, 'PARTIALLY_RECEIVED', 'closed');
    return this.poRepository.updateStatus(id, { status: 'CLOSED' });
  }

  /** Spec: "Print button ... generates the real formatted PDF via GET
   * /:id/pdf ... this is a proper generated document, not just the
   * browser's native 'print this webpage' function." Available regardless
   * of status (spec: "Both actions are available regardless of PO
   * status"). */
  async generatePdf(request: RequestWithAccess, id: string): Promise<Buffer> {
    const po = await this.findById(request, id);
    const outlet = await this.getOutletOrThrow(po.outletId);
    const supplier = await this.supplierRepository.findById(po.supplierId);
    const items = await Promise.all(po.lines.map((line) => this.itemRepository.findById(line.itemId)));

    return generateDocumentPdf({
      documentTypeLabel: 'Purchase Order',
      documentNumber: po.id.slice(0, 8).toUpperCase(),
      statusLabel: po.status.replace(/_/g, ' '),
      outletName: outlet.name,
      supplierName: supplier?.name ?? po.supplierId,
      supplierEmail: supplier?.email ?? undefined,
      currencyCode: po.currencyCode,
      exchangeRateToBase: po.exchangeRateToBase,
      dateLabel: po.createdAt.toLocaleDateString(),
      lines: po.lines.map((line, index) => ({
        itemName: items[index]?.name ?? line.itemId,
        quantity: line.orderedQty,
        unit: items[index]?.unit,
        unitPrice: line.expectedPrice,
        taxComponents: line.taxComponents,
        lineTaxAmount: line.lineTaxAmount,
        lineTotal: line.lineTotal,
      })),
      subtotal: po.subtotal,
      taxAmount: po.taxAmount,
      discountAmount: po.discountAmount,
      otherChargesAmount: po.otherChargesAmount,
      totalValue: po.totalValue,
    });
  }

  /** Spec: "toEmail defaults to the supplier's email field (FR-03) if set,
   * but is always editable before sending... If the supplier has no email
   * on record and none is provided, the request is rejected with a clear
   * validation error rather than silently failing." Emailing a DRAFT PO is
   * still allowed here — the spec's mild "send anyway?" confirmation is a
   * frontend-only prompt, not a backend restriction. */
  async sendEmail(request: RequestWithAccess, id: string, dto: SendEmailDto): Promise<PurchaseOrder> {
    const po = await this.getOrThrow(id);
    assertOutletAccess(request, po.outletId, [...PO_CREATE_ROLES]);

    const supplier = await this.supplierRepository.findById(po.supplierId);
    const toEmail = dto.toEmail ?? supplier?.email ?? undefined;
    if (!toEmail) {
      throw new BadRequestException(
        'No recipient email is on file for this supplier, and none was provided',
      );
    }

    const pdfBuffer = await this.generatePdf(request, id);
    const documentNumber = po.id.slice(0, 8).toUpperCase();

    await this.emailProvider.send({
      to: toEmail,
      cc: dto.ccEmails,
      subject: dto.subject ?? `Purchase Order #${documentNumber}`,
      body: dto.message ?? 'Please find attached our purchase order. Kindly confirm receipt.',
      attachment: { filename: `PO-${documentNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    });

    return this.poRepository.updateEmailSent(id, { lastEmailedAt: new Date(), lastEmailedTo: toEmail });
  }

  private assertStatus(po: PurchaseOrder, expected: POStatus, actionLabel: string): void {
    if (po.status !== expected) {
      throw new ConflictException(
        `Cannot be ${actionLabel} — current status is ${po.status}, expected ${expected}`,
      );
    }
  }

  private async buildLines(lines: CreatePOLineDto[], isTaxInclusive: boolean): Promise<CreatePOLineInput[]> {
    const built: CreatePOLineInput[] = [];
    for (const line of lines) {
      const taxRate = line.taxRateId ? await this.getActiveTaxRateOrThrow(line.taxRateId) : null;
      const computed = applyDocumentLineTax(line.orderedQty, line.expectedPrice, taxRate, isTaxInclusive);
      built.push({
        itemId: line.itemId,
        orderedQty: line.orderedQty,
        expectedPrice: line.expectedPrice,
        taxRateId: line.taxRateId,
        taxRate: taxRate?.ratePercent ?? '0.00',
        lineSubtotal: computed.lineSubtotal,
        lineTaxAmount: computed.lineTaxAmount,
        lineTotal: computed.lineTotal,
        taxComponents: computed.components,
      });
    }
    return built;
  }

  /** Spec: "reject with 400 only if a provided taxRateId references an
   * inactive or non-existent tax rate — omitting it entirely is never an
   * error." Never trusts a client-supplied rate/amount — always re-derived
   * from the stored TaxRate row. */
  private async getActiveTaxRateOrThrow(taxRateId: string): Promise<TaxRate> {
    const taxRate = await this.taxRateRepository.findById(taxRateId);
    if (!taxRate || !taxRate.isActive) {
      throw new BadRequestException(`Tax rate ${taxRateId} is invalid or inactive`);
    }
    return taxRate;
  }

  private async assertSupplierBelongsToOutlet(supplierId: string, outletId: string): Promise<void> {
    const supplier = await this.supplierRepository.findById(supplierId);
    if (!supplier || supplier.outletId !== outletId) {
      throw new BadRequestException(`Supplier ${supplierId} was not found for this outlet`);
    }
  }

  private async getOutletOrThrow(outletId: string) {
    const outlet = await this.outletRepository.findById(outletId);
    if (!outlet) throw new NotFoundException(`Outlet ${outletId} not found`);
    return outlet;
  }

  /** Spec: exchange rate is "user-editable inline on the form" — an
   * explicit client-supplied value always wins. Otherwise: same currency as
   * the outlet's base -> 1; else the latest on-file ExchangeRate for this
   * exact pair; else 1 as a last-resort default (the UI still shows it as
   * editable so the user can correct it before saving). */
  private async resolveExchangeRateToBase(
    currencyCode: string,
    outletBaseCurrency: string,
    explicit: string | undefined,
  ): Promise<string> {
    if (explicit) return explicit;
    if (currencyCode === outletBaseCurrency) return '1';
    const [latest] = await this.exchangeRateRepository.findLatestPerPair({
      baseCurrency: currencyCode,
      targetCurrency: outletBaseCurrency,
    });
    return latest?.rate ?? '1';
  }

  private async getOrThrow(id: string): Promise<PurchaseOrder> {
    const po = await this.poRepository.findById(id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }
}
