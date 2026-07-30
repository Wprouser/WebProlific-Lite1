import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GRN_REPOSITORY } from '../repositories/tokens';
import { CreateGrnLineInput, GrnRepository } from '../repositories/grn.repository';
import { GRN } from '../domain/grn.entity';
import { GRN_CREATE_ROLES, GRN_VARIANCE_OVERRIDE_ROLES, VARIANCE_TOLERANCE_PERCENT } from '../constants/enums';
import { CreateDirectGrnDto } from '../dto/create-direct-grn.dto';
import { CreatePoGrnDto } from '../dto/create-po-grn.dto';
import { CreateGrnLineDto } from '../dto/create-grn-line.dto';
import { QueryGrnDto } from '../dto/query-grn.dto';
import { applyDocumentLineTax, sumDocumentTotals } from '../../purchase-orders/lib/apply-document-tax';
import { PurchaseOrder } from '../../purchase-orders/domain/purchase-order.entity';
import { PURCHASE_ORDER_REPOSITORY } from '../../purchase-orders/repositories/tokens';
import { PurchaseOrderRepository } from '../../purchase-orders/repositories/purchase-order.repository';
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
import { INVOICE_SCAN_REPOSITORY } from '../../invoice-scans/repositories/tokens';
import { InvoiceScanRepository } from '../../invoice-scans/repositories/invoice-scan.repository';
import { ITEM_REPOSITORY, UNIT_OF_MEASURE_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { UnitOfMeasureRepository } from '../../items/repositories/unit-of-measure.repository';
import { EMAIL_PROVIDER } from '../../email/providers/tokens';
import { EmailProvider } from '../../email/providers/email.provider';
import { generateDocumentPdf } from '../../documents/lib/generate-document-pdf';
import { SendEmailDto } from '../../documents/dto/send-email.dto';

// Flow 2's PO picker only ever offers a PO in one of these statuses (spec:
// "filtered to APPROVED, SENT_TO_SUPPLIER, or PARTIALLY_RECEIVED status"),
// enforced here server-side too, not just as a frontend filter.
const RECEIVABLE_PO_STATUSES = ['APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED'];

@Injectable()
export class GrnService {
  constructor(
    @Inject(GRN_REPOSITORY) private readonly grnRepository: GrnRepository,
    @Inject(PURCHASE_ORDER_REPOSITORY) private readonly poRepository: PurchaseOrderRepository,
    @Inject(OUTLET_REPOSITORY) private readonly outletRepository: OutletRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly supplierRepository: SupplierRepository,
    @Inject(EXCHANGE_RATE_REPOSITORY) private readonly exchangeRateRepository: ExchangeRateRepository,
    @Inject(TAX_RATE_REPOSITORY) private readonly taxRateRepository: TaxRateRepository,
    @Inject(INVOICE_SCAN_REPOSITORY) private readonly invoiceScanRepository: InvoiceScanRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly unitRepository: UnitOfMeasureRepository,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly currenciesService: CurrenciesService,
  ) {}

  /** Flow 1 — Direct GRN, no linked PO. No ordered-quantity variance check
   * applies (spec: "there is no orderedQty to compare against"). */
  async createDirect(request: RequestWithAccess, dto: CreateDirectGrnDto): Promise<GRN> {
    assertOutletAccess(request, dto.outletId, [...GRN_CREATE_ROLES]);

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

    const lines = await this.buildDirectLines(dto.lines, isTaxInclusive);
    const totals = sumDocumentTotals(lines, discountAmount, otherChargesAmount);
    const scanFields = await this.resolveInvoiceScanFields(dto.invoiceScanId, dto.outletId);

    return this.grnRepository.create({
      outletId: dto.outletId,
      supplierId: dto.supplierId,
      receivedById: request.user!.id,
      currencyCode,
      exchangeRateToBase,
      isTaxInclusive,
      discountAmount,
      otherChargesAmount,
      invoiceNumber: dto.invoiceNumber,
      varianceFlagged: false,
      ...scanFields,
      ...totals,
      lines,
    });
  }

  /** Flow 2 — Against a PO. Auto-populates from POLine (item, ordered qty,
   * expected price, tax) as defaults the caller may accept or override —
   * the frontend does the pre-fill; here the server only needs the final
   * confirmed values plus the original POLine to validate against. */
  async createAgainstPo(request: RequestWithAccess, poId: string, dto: CreatePoGrnDto): Promise<GRN> {
    const po = await this.getPoOrThrow(poId);
    assertOutletAccess(request, po.outletId, [...GRN_CREATE_ROLES]);

    if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
      throw new ConflictException(
        `Cannot receive against this purchase order — current status is ${po.status}, expected one of ${RECEIVABLE_PO_STATUSES.join(', ')}`,
      );
    }

    const outlet = await this.getOutletOrThrow(po.outletId);
    // Inherited from the PO if linked, otherwise chosen directly (spec) —
    // still editable per this specific GRN.
    const currencyCode = dto.currencyCode ?? po.currencyCode;
    if (dto.currencyCode) await this.currenciesService.getOrThrow(currencyCode);
    const exchangeRateToBase =
      dto.exchangeRateToBase ??
      (dto.currencyCode && dto.currencyCode !== po.currencyCode
        ? await this.resolveExchangeRateToBase(currencyCode, outlet.baseCurrency, undefined)
        : po.exchangeRateToBase);
    const isTaxInclusive = dto.isTaxInclusive ?? po.isTaxInclusive;
    const discountAmount = dto.discountAmount ?? '0.00';
    const otherChargesAmount = dto.otherChargesAmount ?? '0.00';

    const { lines, varianceFlagged } = await this.buildPoLines(dto.lines, po, isTaxInclusive);

    // Spec: "require OUTLET_MANAGER-or-higher approval before proceeding
    // (403 for STORE_STAFF role attempting to finalize a variance GRN)."
    if (varianceFlagged) {
      assertOutletAccess(request, po.outletId, [...GRN_VARIANCE_OVERRIDE_ROLES]);
    }

    const totals = sumDocumentTotals(lines, discountAmount, otherChargesAmount);
    const scanFields = await this.resolveInvoiceScanFields(dto.invoiceScanId, po.outletId);

    return this.grnRepository.create({
      outletId: po.outletId,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      receivedById: request.user!.id,
      currencyCode,
      exchangeRateToBase,
      isTaxInclusive,
      discountAmount,
      otherChargesAmount,
      invoiceNumber: dto.invoiceNumber,
      varianceFlagged,
      ...scanFields,
      ...totals,
      lines,
    });
  }

  async findById(request: RequestWithAccess, id: string): Promise<GRN> {
    const grn = await this.getOrThrow(id);
    assertOutletAccess(request, grn.outletId);
    return grn;
  }

  list(request: RequestWithAccess, query: QueryGrnDto): Promise<GRN[]> {
    return this.grnRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      supplierId: query.supplierId,
      purchaseOrderId: query.purchaseOrderId,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }

  /** Spec: "GET /grn/:id/pdf — Generate and return a formatted PDF of the
   * GRN (goods-received document)." */
  async generatePdf(request: RequestWithAccess, id: string): Promise<Buffer> {
    const grn = await this.findById(request, id);
    const outlet = await this.getOutletOrThrow(grn.outletId);
    const supplier = await this.supplierRepository.findById(grn.supplierId);
    const items = await Promise.all(grn.lines.map((line) => this.itemRepository.findById(line.itemId)));
    const units = await Promise.all(items.map((item) => (item ? this.unitRepository.findById(item.unitId) : null)));

    return generateDocumentPdf({
      documentTypeLabel: 'Goods Received Note',
      documentNumber: grn.id.slice(0, 8).toUpperCase(),
      statusLabel: grn.varianceFlagged ? 'Variance Flagged' : undefined,
      outletName: outlet.name,
      supplierName: supplier?.name ?? grn.supplierId,
      supplierEmail: supplier?.email ?? undefined,
      currencyCode: grn.currencyCode,
      exchangeRateToBase: grn.exchangeRateToBase,
      dateLabel: grn.receivedAt.toLocaleDateString(),
      lines: grn.lines.map((line, index) => ({
        itemName: items[index]?.name ?? line.itemId,
        quantity: line.receivedQty,
        unit: units[index]?.abbreviation,
        unitPrice: line.actualPrice,
        taxComponents: line.taxComponents,
        lineTaxAmount: line.lineTaxAmount,
        lineTotal: line.lineTotal,
      })),
      subtotal: grn.subtotal,
      taxAmount: grn.taxAmount,
      discountAmount: grn.discountAmount,
      otherChargesAmount: grn.otherChargesAmount,
      totalValue: grn.totalValue,
    });
  }

  /** Same recipient-resolution and validation rules as PurchaseOrdersService
   * .sendEmail — see that method's doc comment. */
  async sendEmail(request: RequestWithAccess, id: string, dto: SendEmailDto): Promise<GRN> {
    const grn = await this.getOrThrow(id);
    assertOutletAccess(request, grn.outletId, [...GRN_CREATE_ROLES]);

    const supplier = await this.supplierRepository.findById(grn.supplierId);
    const toEmail = dto.toEmail ?? supplier?.email ?? undefined;
    if (!toEmail) {
      throw new BadRequestException(
        'No recipient email is on file for this supplier, and none was provided',
      );
    }

    const pdfBuffer = await this.generatePdf(request, id);
    const documentNumber = grn.id.slice(0, 8).toUpperCase();

    await this.emailProvider.send({
      to: toEmail,
      cc: dto.ccEmails,
      subject: dto.subject ?? `Goods Received Note #${documentNumber}`,
      body: dto.message ?? 'Please find attached the goods received note for your records.',
      attachment: { filename: `GRN-${documentNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    });

    return this.grnRepository.updateEmailSent(id, { lastEmailedAt: new Date(), lastEmailedTo: toEmail });
  }

  private async buildDirectLines(lines: CreateGrnLineDto[], isTaxInclusive: boolean): Promise<CreateGrnLineInput[]> {
    const built: CreateGrnLineInput[] = [];
    for (const line of lines) {
      const taxRate = line.taxRateId ? await this.getActiveTaxRateOrThrow(line.taxRateId) : null;
      const computed = applyDocumentLineTax(line.receivedQty, line.actualPrice, taxRate, isTaxInclusive);
      built.push({
        itemId: line.itemId,
        receivedQty: line.receivedQty,
        actualPrice: line.actualPrice,
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

  private async buildPoLines(
    lines: CreateGrnLineDto[],
    po: PurchaseOrder,
    isTaxInclusive: boolean,
  ): Promise<{ lines: CreateGrnLineInput[]; varianceFlagged: boolean }> {
    const built: CreateGrnLineInput[] = [];
    let varianceFlagged = false;

    for (const line of lines) {
      // Matched by itemId, not a poLineId the client would have to track
      // itself — matches the spec's illustrative request body, which has
      // no poLineId field at all. Assumes at most one PO line per item,
      // which holds for every PO this system creates (POLine has no unique
      // constraint preventing a duplicate item, but nothing in this FR
      // creates one).
      const poLine = po.lines.find((l) => l.itemId === line.itemId);
      if (!poLine) {
        throw new BadRequestException(`Item ${line.itemId} is not a line on this purchase order`);
      }

      const remaining = Number(poLine.orderedQty) - Number(poLine.receivedQty);
      if (Number(line.receivedQty) > remaining) {
        throw new BadRequestException(
          `Received quantity for item ${line.itemId} (${line.receivedQty}) exceeds the remaining ordered quantity (${remaining.toFixed(3)})`,
        );
      }

      const orderedQtyNum = Number(poLine.orderedQty);
      if (orderedQtyNum !== 0) {
        const variancePercent = (Math.abs(Number(line.receivedQty) - orderedQtyNum) / orderedQtyNum) * 100;
        if (variancePercent > VARIANCE_TOLERANCE_PERCENT) varianceFlagged = true;
      }

      // Never trust the client's echoed taxRateId/price for the tax
      // calculation's correctness, but the user IS allowed to override
      // price/tax/quantity from the PO's defaults (spec) — so, unlike
      // orderedQty (re-sourced from the DB below), taxRateId/actualPrice
      // are read from the request, exactly as the spec intends.
      const taxRate = line.taxRateId ? await this.getActiveTaxRateOrThrow(line.taxRateId) : null;
      const computed = applyDocumentLineTax(line.receivedQty, line.actualPrice, taxRate, isTaxInclusive);
      built.push({
        itemId: line.itemId,
        poLineId: poLine.id,
        orderedQty: poLine.orderedQty,
        receivedQty: line.receivedQty,
        actualPrice: line.actualPrice,
        taxRateId: line.taxRateId,
        taxRate: taxRate?.ratePercent ?? '0.00',
        lineSubtotal: computed.lineSubtotal,
        lineTaxAmount: computed.lineTaxAmount,
        lineTotal: computed.lineTotal,
        taxComponents: computed.components,
      });
    }

    return { lines: built, varianceFlagged };
  }

  /** When this GRN is confirmed from a Scan Invoice session (Flow 3),
   * attaches that scan's file url onto the created GRN — the scan session
   * itself is never touched or consumed here, this is purely a read to
   * carry its artifact forward. Absent invoiceScanId (Flows 1/2's normal
   * path) resolves to no scan fields at all. */
  private async resolveInvoiceScanFields(
    invoiceScanId: string | undefined,
    outletId: string,
  ): Promise<{ invoiceScanUrl?: string; invoiceScanStatus?: 'EXTRACTED' }> {
    if (!invoiceScanId) return {};
    const scan = await this.invoiceScanRepository.findById(invoiceScanId);
    if (!scan || scan.outletId !== outletId) {
      throw new BadRequestException(`Invoice scan ${invoiceScanId} was not found for this outlet`);
    }
    return { invoiceScanUrl: scan.fileUrl, invoiceScanStatus: 'EXTRACTED' };
  }

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

  private async getPoOrThrow(id: string): Promise<PurchaseOrder> {
    const po = await this.poRepository.findById(id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  private async getOrThrow(id: string): Promise<GRN> {
    const grn = await this.grnRepository.findById(id);
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    return grn;
  }
}
