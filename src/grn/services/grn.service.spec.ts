import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GrnService } from './grn.service';
import { GrnRepository } from '../repositories/grn.repository';
import { GRN } from '../domain/grn.entity';
import { PurchaseOrderRepository } from '../../purchase-orders/repositories/purchase-order.repository';
import { PurchaseOrder } from '../../purchase-orders/domain/purchase-order.entity';
import { OutletRepository } from '../../tenancy/repositories/outlet.repository';
import { SupplierRepository } from '../../suppliers/repositories/supplier.repository';
import { ExchangeRateRepository } from '../../exchange-rates/repositories/exchange-rate.repository';
import { TaxRateRepository } from '../../tax-rates/repositories/tax-rate.repository';
import { CurrenciesService } from '../../currencies/services/currencies.service';
import { InvoiceScanRepository } from '../../invoice-scans/repositories/invoice-scan.repository';
import { ItemRepository } from '../../items/repositories/item.repository';
import { EmailProvider } from '../../email/providers/email.provider';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureRequest(role: string | null = 'OUTLET_MANAGER'): RequestWithAccess {
  return {
    user: { id: 'u1' },
    effectiveAccess: {
      userId: 'u1',
      effectiveOutletIds: ['o1'],
      effectivePropertyIds: [],
      effectiveChainIds: [],
      effectiveRole: role as never,
      grants: [],
      roleForChain: () => undefined,
      roleForProperty: () => undefined,
      roleForOutlet: () => role as never,
    },
  } as unknown as RequestWithAccess;
}

function fixtureGrn(overrides: Partial<GRN> = {}): GRN {
  return {
    id: 'g1',
    outletId: 'o1',
    purchaseOrderId: null,
    supplierId: 's1',
    receivedById: 'u1',
    receivedAt: new Date(),
    currencyCode: 'SAR',
    exchangeRateToBase: '1.000000',
    isTaxInclusive: false,
    discountAmount: '0.00',
    otherChargesAmount: '0.00',
    subtotal: '460.00',
    taxAmount: '69.00',
    totalValue: '529.00',
    invoiceNumber: null,
    invoiceScanUrl: null,
    invoiceScanStatus: null,
    varianceFlagged: false,
    lines: [
      {
        id: 'gl1',
        grnId: 'g1',
        itemId: 'i1',
        orderedQty: null,
        receivedQty: '5.000',
        actualPrice: '92.00',
        taxRateId: 't1',
        taxRate: '15.00',
        lineSubtotal: '460.00',
        lineTaxAmount: '69.00',
        lineTotal: '529.00',
        taxComponents: [],
      },
    ],
    lastEmailedAt: null,
    lastEmailedTo: null,
    ...overrides,
  };
}

function fixturePO(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po1',
    outletId: 'o1',
    supplierId: 's1',
    status: 'SENT_TO_SUPPLIER',
    expectedDeliveryDate: null,
    createdById: 'u1',
    approvedById: 'u1',
    approvedAt: new Date(),
    currencyCode: 'SAR',
    exchangeRateToBase: '1.000000',
    isTaxInclusive: false,
    discountAmount: '0.00',
    otherChargesAmount: '0.00',
    subtotal: '1740.00',
    taxAmount: '261.00',
    totalValue: '2001.00',
    lines: [
      {
        id: 'l1',
        purchaseOrderId: 'po1',
        itemId: 'i1',
        orderedQty: '20.000',
        expectedPrice: '87.00',
        taxRateId: 't1',
        taxRate: '15.00',
        lineSubtotal: '1740.00',
        lineTaxAmount: '261.00',
        lineTotal: '2001.00',
        receivedQty: '0.000',
        taxComponents: [],
      },
    ],
    createdAt: new Date(),
    lastEmailedAt: null,
    lastEmailedTo: null,
    ...overrides,
  };
}

const fixtureOutlet = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  propertyId: 'p1',
  chainId: 'c1',
  name: 'Main Restaurant',
  type: 'RESTAURANT',
  baseCurrency: 'SAR',
  poApprovalThreshold: null,
  isActive: true,
  ...overrides,
});

const fixtureSupplier = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  outletId: 'o1',
  name: 'Al-Fahad Trading',
  isActive: true,
  ...overrides,
});

const fixtureTaxRate = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  outletId: 'o1',
  name: 'VAT 15%',
  ratePercent: '15.00',
  isCompound: false,
  isDefault: false,
  isActive: true,
  countryCode: 'SA',
  createdAt: new Date(),
  updatedAt: new Date(),
  components: [],
  ...overrides,
});

describe('GrnService', () => {
  function buildService(existingGrn: GRN = fixtureGrn(), existingPo: PurchaseOrder = fixturePO()) {
    const grnRepository: Partial<GrnRepository> = {
      create: jest.fn().mockResolvedValue(existingGrn),
      findById: jest.fn().mockResolvedValue(existingGrn),
      findScoped: jest.fn().mockResolvedValue([existingGrn]),
      updateEmailSent: jest.fn().mockImplementation((_id, data) => Promise.resolve({ ...existingGrn, ...data })),
    };
    const poRepository: Partial<PurchaseOrderRepository> = {
      findById: jest.fn().mockResolvedValue(existingPo),
    };
    const outletRepository: Partial<OutletRepository> = {
      findById: jest.fn().mockResolvedValue(fixtureOutlet()),
    };
    const supplierRepository: Partial<SupplierRepository> = {
      findById: jest.fn().mockResolvedValue(fixtureSupplier()),
    };
    const exchangeRateRepository: Partial<ExchangeRateRepository> = {
      findLatestPerPair: jest.fn().mockResolvedValue([]),
    };
    const taxRateRepository: Partial<TaxRateRepository> = {
      findById: jest.fn().mockResolvedValue(fixtureTaxRate()),
    };
    const currenciesService: Partial<CurrenciesService> = {
      getOrThrow: jest.fn().mockResolvedValue({ code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 }),
    };
    const invoiceScanRepository: Partial<InvoiceScanRepository> = {
      findById: jest.fn().mockResolvedValue(null),
    };
    const itemRepository: Partial<ItemRepository> = {
      findById: jest.fn().mockResolvedValue({ id: 'i1', name: 'Basmati Rice', unit: 'KG' }),
    };
    const emailProvider: Partial<EmailProvider> = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    const service = new GrnService(
      grnRepository as GrnRepository,
      poRepository as PurchaseOrderRepository,
      outletRepository as OutletRepository,
      supplierRepository as SupplierRepository,
      exchangeRateRepository as ExchangeRateRepository,
      taxRateRepository as TaxRateRepository,
      invoiceScanRepository as InvoiceScanRepository,
      itemRepository as ItemRepository,
      emailProvider as EmailProvider,
      currenciesService as CurrenciesService,
    );
    return {
      service,
      grnRepository,
      poRepository,
      outletRepository,
      supplierRepository,
      exchangeRateRepository,
      taxRateRepository,
      invoiceScanRepository,
      itemRepository,
      emailProvider,
      currenciesService,
    };
  }

  const directDto = {
    outletId: 'o1',
    supplierId: 's1',
    lines: [{ itemId: 'i1', receivedQty: '5', actualPrice: '92.00', taxRateId: 't1' }],
  };

  describe('createDirect', () => {
    it('AC: a GRN can be created with no linked PO, supplier chosen directly', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest(), directDto);
      const call = (grnRepository.create as jest.Mock).mock.calls[0][0];
      expect(call).toEqual(expect.objectContaining({ supplierId: 's1', varianceFlagged: false }));
      expect(call.purchaseOrderId).toBeUndefined();
    });

    it('AC: STORE_STAFF can create a Direct GRN (broad role set)', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest('STORE_STAFF'), directDto);
      expect(grnRepository.create).toHaveBeenCalled();
    });

    it('rejects CHEF from creating a GRN', async () => {
      const { service } = buildService();
      await expect(service.createDirect(fixtureRequest('CHEF'), directDto)).rejects.toThrow(ForbiddenException);
    });

    it('AC: a line with no taxRateId produces a valid, untaxed line (never rejected)', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest(), {
        ...directDto,
        lines: [{ itemId: 'i1', receivedQty: '5', actualPrice: '92.00' }],
      });
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [expect.objectContaining({ lineTaxAmount: '0.00', taxRateId: undefined })],
        }),
      );
    });

    it('AC: an invalid/inactive taxRateId is rejected with 400', async () => {
      const { service, taxRateRepository } = buildService();
      (taxRateRepository.findById as jest.Mock).mockResolvedValue({ ...fixtureTaxRate(), isActive: false });
      await expect(service.createDirect(fixtureRequest(), directDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a supplier that does not belong to the given outlet', async () => {
      const { service, supplierRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(fixtureSupplier({ outletId: 'o2' }));
      await expect(service.createDirect(fixtureRequest(), directDto)).rejects.toThrow(BadRequestException);
    });

    it('AC: computes Net/Tax/Gross correctly for a simple tax rate', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest(), directDto);
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ subtotal: '460.00', taxAmount: '69.00', totalValue: '529.00' }),
      );
    });

    it('AC: includes Other Charges in the Gross total', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest(), { ...directDto, otherChargesAmount: '10.00' });
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ otherChargesAmount: '10.00', totalValue: '539.00' }),
      );
    });

    it('AC: Discount reduces the Gross total', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest(), { ...directDto, discountAmount: '10.00' });
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ discountAmount: '10.00', totalValue: '519.00' }),
      );
    });

    it('defaults currencyCode to the outlet base currency when omitted', async () => {
      const { service, grnRepository } = buildService();
      await service.createDirect(fixtureRequest(), directDto);
      expect(grnRepository.create).toHaveBeenCalledWith(expect.objectContaining({ currencyCode: 'SAR' }));
    });

    it('AC: confirming from a Scan Invoice session attaches the scan file url onto the created GRN', async () => {
      const { service, grnRepository, invoiceScanRepository } = buildService();
      (invoiceScanRepository.findById as jest.Mock).mockResolvedValue({
        id: 'scan1',
        outletId: 'o1',
        fileUrl: '/uploads/invoice-scans/inv-123.jpg',
        status: 'EXTRACTED',
        extractedData: null,
        failureReason: null,
        createdById: 'u1',
        createdAt: new Date(),
      });
      await service.createDirect(fixtureRequest(), { ...directDto, invoiceScanId: 'scan1' });
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceScanUrl: '/uploads/invoice-scans/inv-123.jpg', invoiceScanStatus: 'EXTRACTED' }),
      );
    });

    it('rejects an invoiceScanId that belongs to a different outlet', async () => {
      const { service, invoiceScanRepository } = buildService();
      (invoiceScanRepository.findById as jest.Mock).mockResolvedValue({
        id: 'scan1',
        outletId: 'other-outlet',
        fileUrl: '/uploads/invoice-scans/inv-123.jpg',
        status: 'EXTRACTED',
        extractedData: null,
        failureReason: null,
        createdById: 'u1',
        createdAt: new Date(),
      });
      await expect(
        service.createDirect(fixtureRequest(), { ...directDto, invoiceScanId: 'scan1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createAgainstPo', () => {
    const poDto = {
      lines: [{ itemId: 'i1', receivedQty: '20', actualPrice: '87.00', taxRateId: 't1' }],
    };

    it('AC: selecting a PO auto-populates via its lines — orderedQty is sourced from the DB, not the client', async () => {
      const { service, grnRepository } = buildService(fixtureGrn(), fixturePO());
      await service.createAgainstPo(fixtureRequest(), 'po1', poDto);
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseOrderId: 'po1',
          supplierId: 's1',
          lines: [expect.objectContaining({ poLineId: 'l1', orderedQty: '20.000', receivedQty: '20' })],
        }),
      );
    });

    it('inherits currency/exchangeRate/isTaxInclusive from the PO when not overridden', async () => {
      const { service, grnRepository } = buildService(
        fixtureGrn(),
        fixturePO({ currencyCode: 'USD', exchangeRateToBase: '3.750000', isTaxInclusive: true }),
      );
      await service.createAgainstPo(fixtureRequest(), 'po1', poDto);
      expect(grnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ currencyCode: 'USD', exchangeRateToBase: '3.750000', isTaxInclusive: true }),
      );
    });

    it('AC: GRN receipt beyond the ordered quantity is rejected at the API level', async () => {
      const { service } = buildService(fixtureGrn(), fixturePO());
      await expect(
        service.createAgainstPo(fixtureRequest(), 'po1', {
          lines: [{ itemId: 'i1', receivedQty: '25', actualPrice: '87.00', taxRateId: 't1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a line for an item that is not on this PO', async () => {
      const { service } = buildService(fixtureGrn(), fixturePO());
      await expect(
        service.createAgainstPo(fixtureRequest(), 'po1', {
          lines: [{ itemId: 'not-on-po', receivedQty: '1', actualPrice: '87.00' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects receiving against a PO that is not APPROVED/SENT_TO_SUPPLIER/PARTIALLY_RECEIVED', async () => {
      const { service } = buildService(fixtureGrn(), fixturePO({ status: 'DRAFT' }));
      await expect(service.createAgainstPo(fixtureRequest(), 'po1', poDto)).rejects.toThrow(ConflictException);
    });

    it('AC: variance beyond tolerance flags the GRN and blocks STORE_STAFF (403)', async () => {
      const { service } = buildService(fixtureGrn(), fixturePO());
      // Ordered 20, received 10 -> 50% variance, well beyond the 10% default.
      await expect(
        service.createAgainstPo(fixtureRequest('STORE_STAFF'), 'po1', {
          lines: [{ itemId: 'i1', receivedQty: '10', actualPrice: '87.00', taxRateId: 't1' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('AC: variance beyond tolerance is allowed for OUTLET_MANAGER-or-higher, with varianceFlagged set', async () => {
      const { service, grnRepository } = buildService(fixtureGrn(), fixturePO());
      await service.createAgainstPo(fixtureRequest('OUTLET_MANAGER'), 'po1', {
        lines: [{ itemId: 'i1', receivedQty: '10', actualPrice: '87.00', taxRateId: 't1' }],
      });
      expect(grnRepository.create).toHaveBeenCalledWith(expect.objectContaining({ varianceFlagged: true }));
    });

    it('AC: Direct GRNs never trigger the variance check — within-tolerance PO receipt does not flag either', async () => {
      const { service, grnRepository } = buildService(fixtureGrn(), fixturePO());
      // Ordered 20, received 19 -> 5% variance, within the 10% default.
      await service.createAgainstPo(fixtureRequest('STORE_STAFF'), 'po1', {
        lines: [{ itemId: 'i1', receivedQty: '19', actualPrice: '87.00', taxRateId: 't1' }],
      });
      expect(grnRepository.create).toHaveBeenCalledWith(expect.objectContaining({ varianceFlagged: false }));
    });

    it('validates receivedQty against the remaining (not full) ordered quantity on a second partial receipt', async () => {
      const { service } = buildService(fixtureGrn(), fixturePO({ lines: [{ ...fixturePO().lines[0]!, receivedQty: '15.000' }] }));
      await expect(
        service.createAgainstPo(fixtureRequest(), 'po1', {
          lines: [{ itemId: 'i1', receivedQty: '10', actualPrice: '87.00', taxRateId: 't1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById / list', () => {
    it('throws NotFoundException for a missing GRN', async () => {
      const { service, grnRepository } = buildService();
      (grnRepository.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.findById(fixtureRequest(), 'missing')).rejects.toThrow(NotFoundException);
    });

    it("list scopes by the caller's effectiveOutletIds", async () => {
      const { service, grnRepository } = buildService();
      await service.list(fixtureRequest(), {});
      expect(grnRepository.findScoped).toHaveBeenCalledWith(expect.objectContaining({ accessibleOutletIds: ['o1'] }));
    });
  });

  describe('generatePdf', () => {
    it('AC: produces a real formatted PDF via the shared generator', async () => {
      const { service } = buildService();
      const buffer = await service.generatePdf(fixtureRequest(), 'g1');
      expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });
  });

  describe('sendEmail', () => {
    it('AC: defaults the recipient to the supplier email on file', async () => {
      const { service, supplierRepository, emailProvider, grnRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(
        fixtureSupplier({ email: 'supplier@example.com' }),
      );
      await service.sendEmail(fixtureRequest(), 'g1', {});
      expect(emailProvider.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'supplier@example.com' }));
      expect(grnRepository.updateEmailSent).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ lastEmailedTo: 'supplier@example.com' }),
      );
    });

    it('AC: rejects with a clear error when there is no valid recipient email at all', async () => {
      const { service, supplierRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(fixtureSupplier({ email: null }));
      await expect(service.sendEmail(fixtureRequest(), 'g1', {})).rejects.toThrow(BadRequestException);
    });
  });
});
