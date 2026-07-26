import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderRepository } from '../repositories/purchase-order.repository';
import { PurchaseOrder } from '../domain/purchase-order.entity';
import { OutletRepository } from '../../tenancy/repositories/outlet.repository';
import { SupplierRepository } from '../../suppliers/repositories/supplier.repository';
import { ExchangeRateRepository } from '../../exchange-rates/repositories/exchange-rate.repository';
import { TaxRateRepository } from '../../tax-rates/repositories/tax-rate.repository';
import { CurrenciesService } from '../../currencies/services/currencies.service';
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

function fixturePO(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po1',
    outletId: 'o1',
    supplierId: 's1',
    status: 'DRAFT',
    expectedDeliveryDate: null,
    createdById: 'u1',
    approvedById: null,
    approvedAt: null,
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

describe('PurchaseOrdersService', () => {
  function buildService(existing: PurchaseOrder = fixturePO()) {
    const poRepository: Partial<PurchaseOrderRepository> = {
      create: jest.fn().mockResolvedValue(existing),
      findById: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(existing),
      updateStatus: jest.fn().mockImplementation((_id, data) => Promise.resolve({ ...existing, ...data })),
      findScoped: jest.fn().mockResolvedValue([existing]),
      updateEmailSent: jest.fn().mockImplementation((_id, data) => Promise.resolve({ ...existing, ...data })),
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
    const itemRepository: Partial<ItemRepository> = {
      findById: jest.fn().mockResolvedValue({ id: 'i1', name: 'Basmati Rice', unit: 'KG' }),
    };
    const emailProvider: Partial<EmailProvider> = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PurchaseOrdersService(
      poRepository as PurchaseOrderRepository,
      outletRepository as OutletRepository,
      supplierRepository as SupplierRepository,
      exchangeRateRepository as ExchangeRateRepository,
      taxRateRepository as TaxRateRepository,
      itemRepository as ItemRepository,
      emailProvider as EmailProvider,
      currenciesService as CurrenciesService,
    );
    return {
      service,
      poRepository,
      outletRepository,
      supplierRepository,
      exchangeRateRepository,
      taxRateRepository,
      itemRepository,
      emailProvider,
      currenciesService,
    };
  }

  const createDto = {
    outletId: 'o1',
    supplierId: 's1',
    lines: [{ itemId: 'i1', orderedQty: '20', expectedPrice: '87.00', taxRateId: 't1' }],
  };

  describe('create', () => {
    it('AC: STORE_STAFF can create a PO (broader role set than approve)', async () => {
      const { service, poRepository } = buildService();
      await service.create(fixtureRequest('STORE_STAFF'), createDto);
      expect(poRepository.create).toHaveBeenCalled();
    });

    it('rejects CHEF from creating a PO', async () => {
      const { service } = buildService();
      await expect(service.create(fixtureRequest('CHEF'), createDto)).rejects.toThrow(ForbiddenException);
    });

    it('computes line/document totals correctly for a simple tax rate', async () => {
      const { service, poRepository } = buildService();
      await service.create(fixtureRequest(), createDto);
      expect(poRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subtotal: '1740.00',
          taxAmount: '261.00',
          totalValue: '2001.00',
          lines: [
            expect.objectContaining({
              lineSubtotal: '1740.00',
              lineTaxAmount: '261.00',
              lineTotal: '2001.00',
              taxRate: '15.00',
            }),
          ],
        }),
      );
    });

    it('AC: rejects an invalid/inactive taxRateId with 400', async () => {
      const { service, taxRateRepository } = buildService();
      (taxRateRepository.findById as jest.Mock).mockResolvedValue({ ...fixtureTaxRate(), isActive: false });
      await expect(service.create(fixtureRequest(), createDto)).rejects.toThrow(BadRequestException);
    });

    it('AC: omitting taxRateId entirely is never an error — produces an untaxed line', async () => {
      const { service, poRepository } = buildService();
      await service.create(fixtureRequest(), {
        ...createDto,
        lines: [{ itemId: 'i1', orderedQty: '5', expectedPrice: '92.00' }],
      });
      expect(poRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [expect.objectContaining({ lineTaxAmount: '0.00', taxRateId: undefined })],
        }),
      );
    });

    it('rejects a supplier that does not belong to the given outlet', async () => {
      const { service, supplierRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(fixtureSupplier({ outletId: 'o2' }));
      await expect(service.create(fixtureRequest(), createDto)).rejects.toThrow(BadRequestException);
    });

    it('defaults currencyCode to the outlet base currency when omitted', async () => {
      const { service, poRepository } = buildService();
      await service.create(fixtureRequest(), createDto);
      expect(poRepository.create).toHaveBeenCalledWith(expect.objectContaining({ currencyCode: 'SAR' }));
    });

    it('AC: an explicit exchangeRateToBase always wins over auto-derivation', async () => {
      const { service, poRepository, exchangeRateRepository } = buildService();
      await service.create(fixtureRequest(), { ...createDto, currencyCode: 'USD', exchangeRateToBase: '3.80' });
      expect(poRepository.create).toHaveBeenCalledWith(expect.objectContaining({ exchangeRateToBase: '3.80' }));
      expect(exchangeRateRepository.findLatestPerPair).not.toHaveBeenCalled();
    });

    it('auto-derives exchangeRateToBase from the latest on-file rate when omitted and currency differs', async () => {
      const { service, poRepository, exchangeRateRepository } = buildService();
      (exchangeRateRepository.findLatestPerPair as jest.Mock).mockResolvedValue([
        { id: 'r1', baseCurrency: 'USD', targetCurrency: 'SAR', rate: '3.750000', effectiveDate: new Date(), source: 'MANUAL' },
      ]);
      await service.create(fixtureRequest(), { ...createDto, currencyCode: 'USD' });
      expect(poRepository.create).toHaveBeenCalledWith(expect.objectContaining({ exchangeRateToBase: '3.750000' }));
    });

    it('defaults exchangeRateToBase to 1 when the currency matches the outlet base currency', async () => {
      const { service, poRepository } = buildService();
      await service.create(fixtureRequest(), { ...createDto, currencyCode: 'SAR' });
      expect(poRepository.create).toHaveBeenCalledWith(expect.objectContaining({ exchangeRateToBase: '1' }));
    });
  });

  describe('update', () => {
    it('AC: only a DRAFT purchase order can be edited', async () => {
      const { service } = buildService(fixturePO({ status: 'PENDING_APPROVAL' }));
      await expect(service.update(fixtureRequest(), 'po1', { discountAmount: '5.00' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('recomputes totals when only isTaxInclusive is toggled, without resending lines', async () => {
      const { service, poRepository } = buildService();
      await service.update(fixtureRequest(), 'po1', { isTaxInclusive: true });
      const call = (poRepository.update as jest.Mock).mock.calls[0][1];
      expect(call.isTaxInclusive).toBe(true);
      // Existing line was 20 * 87.00 = 1740.00 exclusive; inclusive mode
      // reinterprets the same qty/price, so totals must actually change.
      expect(call.lines[0].lineSubtotal).not.toBe('1740.00');
    });
  });

  describe('submit', () => {
    it('AC: DRAFT -> PENDING_APPROVAL', async () => {
      const { service, poRepository } = buildService();
      await service.submit(fixtureRequest(), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalledWith('po1', { status: 'PENDING_APPROVAL' });
    });

    it('rejects submitting a non-DRAFT PO', async () => {
      const { service } = buildService(fixturePO({ status: 'APPROVED' }));
      await expect(service.submit(fixtureRequest(), 'po1')).rejects.toThrow(ConflictException);
    });
  });

  describe('approve', () => {
    function pendingPO(overrides: Partial<PurchaseOrder> = {}) {
      return fixturePO({ status: 'PENDING_APPROVAL', ...overrides });
    }

    it('AC: a STORE_STAFF cannot approve a PO regardless of value', async () => {
      const { service } = buildService(pendingPO());
      await expect(service.approve(fixtureRequest('STORE_STAFF'), 'po1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects CHEF too', async () => {
      const { service } = buildService(pendingPO());
      await expect(service.approve(fixtureRequest('CHEF'), 'po1')).rejects.toThrow(ForbiddenException);
    });

    it('AC: CHAIN_OWNER can always approve, even above the threshold', async () => {
      const { service, outletRepository, poRepository } = buildService(pendingPO({ totalValue: '999999.00' }));
      (outletRepository.findById as jest.Mock).mockResolvedValue(fixtureOutlet({ poApprovalThreshold: '5000.00' }));
      await service.approve(fixtureRequest('CHAIN_OWNER'), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalledWith(
        'po1',
        expect.objectContaining({ status: 'APPROVED', approvedById: 'u1' }),
      );
    });

    it('AC: PROPERTY_MANAGER can approve below the threshold', async () => {
      const { service, outletRepository, poRepository } = buildService(pendingPO({ totalValue: '2001.00' }));
      (outletRepository.findById as jest.Mock).mockResolvedValue(fixtureOutlet({ poApprovalThreshold: '5000.00' }));
      await service.approve(fixtureRequest('PROPERTY_MANAGER'), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalled();
    });

    it('AC: OUTLET_MANAGER is rejected at or above the threshold', async () => {
      const { service, outletRepository } = buildService(pendingPO({ totalValue: '5000.00' }));
      (outletRepository.findById as jest.Mock).mockResolvedValue(fixtureOutlet({ poApprovalThreshold: '5000.00' }));
      await expect(service.approve(fixtureRequest('OUTLET_MANAGER'), 'po1')).rejects.toThrow(ForbiddenException);
    });

    it('converts totalValue to the outlet base currency before comparing to the threshold', async () => {
      // PO raised in USD at 3.75 SAR/USD; totalValue=100 USD -> 375 SAR,
      // above a 300 SAR threshold -> PROPERTY_MANAGER blocked.
      const { service, outletRepository } = buildService(
        pendingPO({ totalValue: '100.00', currencyCode: 'USD', exchangeRateToBase: '3.75' }),
      );
      (outletRepository.findById as jest.Mock).mockResolvedValue(
        fixtureOutlet({ poApprovalThreshold: '300.00' }),
      );
      await expect(service.approve(fixtureRequest('PROPERTY_MANAGER'), 'po1')).rejects.toThrow(ForbiddenException);
    });

    it('no threshold set means no cap at all for PROPERTY_MANAGER/OUTLET_MANAGER', async () => {
      const { service, poRepository } = buildService(pendingPO({ totalValue: '999999.00' }));
      await service.approve(fixtureRequest('PROPERTY_MANAGER'), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalled();
    });

    it('rejects approving a non-PENDING_APPROVAL PO', async () => {
      const { service } = buildService(fixturePO({ status: 'DRAFT' }));
      await expect(service.approve(fixtureRequest(), 'po1')).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    it('rejects (REJECTED) a PENDING_APPROVAL PO', async () => {
      const { service, poRepository } = buildService(fixturePO({ status: 'PENDING_APPROVAL' }));
      await service.reject(fixtureRequest(), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalledWith('po1', { status: 'REJECTED' });
    });

    it('STORE_STAFF cannot reject', async () => {
      const { service } = buildService(fixturePO({ status: 'PENDING_APPROVAL' }));
      await expect(service.reject(fixtureRequest('STORE_STAFF'), 'po1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('send', () => {
    it('APPROVED -> SENT_TO_SUPPLIER', async () => {
      const { service, poRepository } = buildService(fixturePO({ status: 'APPROVED' }));
      await service.send(fixtureRequest(), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalledWith('po1', { status: 'SENT_TO_SUPPLIER' });
    });

    it('rejects sending a non-APPROVED PO', async () => {
      const { service } = buildService(fixturePO({ status: 'DRAFT' }));
      await expect(service.send(fixtureRequest(), 'po1')).rejects.toThrow(ConflictException);
    });
  });

  describe('close', () => {
    it('AC: PARTIALLY_RECEIVED -> CLOSED, by OUTLET_MANAGER/PROPERTY_MANAGER/CHAIN_OWNER', async () => {
      const { service, poRepository } = buildService(fixturePO({ status: 'PARTIALLY_RECEIVED' }));
      await service.close(fixtureRequest('OUTLET_MANAGER'), 'po1');
      expect(poRepository.updateStatus).toHaveBeenCalledWith('po1', { status: 'CLOSED' });
    });

    it('rejects closing a PO that is not PARTIALLY_RECEIVED', async () => {
      const { service } = buildService(fixturePO({ status: 'FULLY_RECEIVED' }));
      await expect(service.close(fixtureRequest(), 'po1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findById / list', () => {
    it('throws NotFoundException for a missing PO', async () => {
      const { service, poRepository } = buildService();
      (poRepository.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.findById(fixtureRequest(), 'missing')).rejects.toThrow(NotFoundException);
    });

    it('list scopes by the caller\'s effectiveOutletIds', async () => {
      const { service, poRepository } = buildService();
      await service.list(fixtureRequest(), {});
      expect(poRepository.findScoped).toHaveBeenCalledWith(expect.objectContaining({ accessibleOutletIds: ['o1'] }));
    });
  });

  describe('generatePdf', () => {
    it('AC: produces a real formatted PDF via the shared generator', async () => {
      const { service } = buildService();
      const buffer = await service.generatePdf(fixtureRequest(), 'po1');
      expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('is available regardless of PO status', async () => {
      const { service } = buildService(fixturePO({ status: 'CLOSED' }));
      const buffer = await service.generatePdf(fixtureRequest(), 'po1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  describe('sendEmail', () => {
    it('AC: defaults the recipient to the supplier email on file', async () => {
      const { service, supplierRepository, emailProvider, poRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(
        fixtureSupplier({ email: 'supplier@example.com' }),
      );
      await service.sendEmail(fixtureRequest(), 'po1', {});
      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'supplier@example.com' }),
      );
      expect(poRepository.updateEmailSent).toHaveBeenCalledWith(
        'po1',
        expect.objectContaining({ lastEmailedTo: 'supplier@example.com' }),
      );
    });

    it('AC: an explicit toEmail always overrides the supplier default', async () => {
      const { service, supplierRepository, emailProvider } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(
        fixtureSupplier({ email: 'supplier@example.com' }),
      );
      await service.sendEmail(fixtureRequest(), 'po1', { toEmail: 'override@example.com' });
      expect(emailProvider.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'override@example.com' }));
    });

    it('AC: rejects with a clear error when there is no valid recipient email at all', async () => {
      const { service, supplierRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(fixtureSupplier({ email: null }));
      await expect(service.sendEmail(fixtureRequest(), 'po1', {})).rejects.toThrow(BadRequestException);
    });

    it('attaches the generated PDF to the email', async () => {
      const { service, supplierRepository, emailProvider } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(
        fixtureSupplier({ email: 'supplier@example.com' }),
      );
      await service.sendEmail(fixtureRequest(), 'po1', {});
      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ attachment: expect.objectContaining({ contentType: 'application/pdf' }) }),
      );
    });
  });
});
