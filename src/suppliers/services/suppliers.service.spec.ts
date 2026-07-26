import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SupplierRepository } from '../repositories/supplier.repository';
import { SupplierPriceHistoryRepository } from '../repositories/supplier-price-history.repository';
import { Supplier } from '../domain/supplier.entity';
import { CurrenciesService } from '../../currencies/services/currencies.service';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    outletId: 'o1',
    supplierCode: 'SUP-001',
    name: 'Al-Fahad Trading',
    contactPerson: null,
    phone: null,
    email: null,
    addressLine: null,
    city: null,
    stateOrProvince: null,
    countryCode: null,
    postalCode: null,
    preferredCurrency: 'SAR',
    taxRegistrationType: null,
    taxRegistrationNumber: null,
    paymentTerms: null,
    leadTimeDays: null,
    bankAccountName: null,
    bankAccountNumber: null,
    bankIfscOrSwift: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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

describe('SuppliersService', () => {
  function buildService(existing: Supplier = fixtureSupplier()) {
    const supplierRepository: Partial<SupplierRepository> = {
      create: jest.fn().mockResolvedValue(existing),
      findById: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({ ...existing, isActive: false }),
      findScoped: jest.fn().mockResolvedValue([existing]),
    };
    const priceHistoryRepository: Partial<SupplierPriceHistoryRepository> = {
      findScoped: jest.fn().mockResolvedValue([]),
    };
    const currenciesService: Partial<CurrenciesService> = {
      getOrThrow: jest.fn().mockResolvedValue({ code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 }),
    };
    const service = new SuppliersService(
      supplierRepository as SupplierRepository,
      priceHistoryRepository as SupplierPriceHistoryRepository,
      currenciesService as CurrenciesService,
    );
    return { service, supplierRepository, priceHistoryRepository, currenciesService };
  }

  const createDto = { outletId: 'o1', name: 'Al-Fahad Trading' };

  describe('create', () => {
    it('creates for OUTLET_MANAGER (broader role set than Tax Rate/Currency)', async () => {
      const { service, supplierRepository } = buildService();
      await service.create(fixtureRequest('OUTLET_MANAGER'), createDto);
      expect(supplierRepository.create).toHaveBeenCalledWith(createDto);
    });

    it('creates for PROPERTY_MANAGER and CHAIN_OWNER too', async () => {
      const { service, supplierRepository } = buildService();
      await service.create(fixtureRequest('PROPERTY_MANAGER'), createDto);
      await service.create(fixtureRequest('CHAIN_OWNER'), createDto);
      expect(supplierRepository.create).toHaveBeenCalledTimes(2);
    });

    it('rejects STORE_STAFF/CHEF', async () => {
      const { service } = buildService();
      await expect(service.create(fixtureRequest('STORE_STAFF'), createDto)).rejects.toThrow(ForbiddenException);
      await expect(service.create(fixtureRequest('CHEF'), createDto)).rejects.toThrow(ForbiddenException);
    });

    it('AC: a supplier can be saved with no tax registration fields at all', async () => {
      const { service, supplierRepository } = buildService();
      await service.create(fixtureRequest(), { outletId: 'o1', name: 'No-Tax Local Supplier' });
      expect(supplierRepository.create).toHaveBeenCalledWith({ outletId: 'o1', name: 'No-Tax Local Supplier' });
    });

    it('AC: validates preferredCurrency against the real Currency registry when provided', async () => {
      const { service, currenciesService } = buildService();
      await service.create(fixtureRequest(), { ...createDto, preferredCurrency: 'SAR' });
      expect(currenciesService.getOrThrow).toHaveBeenCalledWith('SAR');
    });

    it('does not touch the Currency registry when preferredCurrency is omitted', async () => {
      const { service, currenciesService } = buildService();
      await service.create(fixtureRequest(), createDto);
      expect(currenciesService.getOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates for an authorized role', async () => {
      const { service, supplierRepository } = buildService();
      await service.update(fixtureRequest('OUTLET_MANAGER'), 's1', { name: 'Renamed Supplier' });
      expect(supplierRepository.update).toHaveBeenCalledWith('s1', { name: 'Renamed Supplier' });
    });

    it('rejects STORE_STAFF', async () => {
      const { service } = buildService();
      await expect(
        service.update(fixtureRequest('STORE_STAFF'), 's1', { name: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for a missing supplier', async () => {
      const { service, supplierRepository } = buildService();
      (supplierRepository.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.update(fixtureRequest(), 'missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('AC: soft-deactivates (isActive: false), never hard-deletes', async () => {
      const { service, supplierRepository } = buildService();
      await service.deactivate(fixtureRequest('OUTLET_MANAGER'), 's1');
      expect(supplierRepository.update).toHaveBeenCalledWith('s1', { isActive: false });
    });

    it('rejects STORE_STAFF', async () => {
      const { service } = buildService();
      await expect(service.deactivate(fixtureRequest('STORE_STAFF'), 's1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('list', () => {
    it('scopes by the caller\'s effectiveOutletIds', async () => {
      const { service, supplierRepository } = buildService();
      await service.list(fixtureRequest(), { search: 'fahad' });
      expect(supplierRepository.findScoped).toHaveBeenCalledWith(
        expect.objectContaining({ accessibleOutletIds: ['o1'], search: 'fahad' }),
      );
    });

    it('any role (including CHEF/STORE_STAFF) can list — read is not mutation-gated', async () => {
      const { service, supplierRepository } = buildService();
      await service.list(fixtureRequest('CHEF'), {});
      expect(supplierRepository.findScoped).toHaveBeenCalled();
    });
  });

  describe('priceHistory', () => {
    it('scopes to the supplier and optional itemId', async () => {
      const { service, priceHistoryRepository } = buildService();
      await service.priceHistory(fixtureRequest(), 's1', 'i1');
      expect(priceHistoryRepository.findScoped).toHaveBeenCalledWith({ supplierId: 's1', itemId: 'i1' });
    });
  });

  describe('performance', () => {
    it('AC: returns an honest empty baseline, not a fabricated score, since no GRN data can exist yet', async () => {
      const { service } = buildService();
      const result = await service.performance(fixtureRequest(), 's1');
      expect(result).toEqual({ totalGrns: 0, onTimeRate: null, priceConsistencyScore: null });
    });
  });
});
