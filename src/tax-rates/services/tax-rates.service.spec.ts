import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaxRatesService } from './tax-rates.service';
import { TaxRateRepository } from '../repositories/tax-rate.repository';
import { TaxRate } from '../domain/tax-rate.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureRequest(role: string | null = 'PROPERTY_MANAGER'): RequestWithAccess {
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

function fixtureTaxRate(overrides: Partial<TaxRate> = {}): TaxRate {
  return {
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
  };
}

describe('TaxRatesService', () => {
  function buildService(existing: TaxRate = fixtureTaxRate()) {
    const taxRateRepository: Partial<TaxRateRepository> = {
      create: jest.fn().mockResolvedValue(existing),
      findById: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({ ...existing, isActive: false }),
      findScoped: jest.fn().mockResolvedValue([existing]),
    };
    const service = new TaxRatesService(taxRateRepository as TaxRateRepository);
    return { service, taxRateRepository };
  }

  const createDto = { outletId: 'o1', name: 'VAT 15%', ratePercent: '15.00' };

  describe('create — simple rates', () => {
    it('creates for PROPERTY_MANAGER', async () => {
      const { service, taxRateRepository } = buildService();
      await service.create(fixtureRequest('PROPERTY_MANAGER'), createDto);
      expect(taxRateRepository.create).toHaveBeenCalledWith(createDto);
    });

    it('creates for CHAIN_OWNER', async () => {
      const { service, taxRateRepository } = buildService();
      await service.create(fixtureRequest('CHAIN_OWNER'), createDto);
      expect(taxRateRepository.create).toHaveBeenCalledWith(createDto);
    });

    it('AC: rejects OUTLET_MANAGER — narrower role set than Item/Category, which does allow it', async () => {
      const { service } = buildService();
      await expect(service.create(fixtureRequest('OUTLET_MANAGER'), createDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects STORE_STAFF', async () => {
      const { service } = buildService();
      await expect(service.create(fixtureRequest('STORE_STAFF'), createDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('AC: rejects ratePercent above 100', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), { ...createDto, ratePercent: '150.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC: rejects a negative ratePercent', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), { ...createDto, ratePercent: '-5.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts the boundary values 0 and 100', async () => {
      const { service, taxRateRepository } = buildService();
      await service.create(fixtureRequest(), { ...createDto, ratePercent: '0.00' });
      await service.create(fixtureRequest(), { ...createDto, ratePercent: '100.00' });
      expect(taxRateRepository.create).toHaveBeenCalledTimes(2);
    });

    it('rejects components being set on a non-compound rate', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), {
          ...createDto,
          components: [{ componentName: 'CGST', componentRate: '7.50' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — compound rates', () => {
    const compoundDto = {
      outletId: 'o1',
      name: 'GST 18% (Intra-state)',
      ratePercent: '18.00',
      isCompound: true,
      components: [
        { componentName: 'CGST', componentRate: '9.00' },
        { componentName: 'SGST', componentRate: '9.00' },
      ],
    };

    it('AC: creates a compound rate whose components sum to the stated overall rate', async () => {
      const { service, taxRateRepository } = buildService();
      await service.create(fixtureRequest(), compoundDto);
      expect(taxRateRepository.create).toHaveBeenCalledWith(compoundDto);
    });

    it('AC: accepts a single-component compound rate (e.g. IGST)', async () => {
      const { service, taxRateRepository } = buildService();
      const igstDto = {
        outletId: 'o1',
        name: 'GST 18% (Inter-state)',
        ratePercent: '18.00',
        isCompound: true,
        components: [{ componentName: 'IGST', componentRate: '18.00' }],
      };
      await service.create(fixtureRequest(), igstDto);
      expect(taxRateRepository.create).toHaveBeenCalledWith(igstDto);
    });

    it('AC: rejects a compound rate whose components do not sum to the stated rate', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), {
          ...compoundDto,
          components: [
            { componentName: 'CGST', componentRate: '8.00' },
            { componentName: 'SGST', componentRate: '9.00' },
          ],
        }),
      ).rejects.toThrow(/Components sum to 17.00%, but the tax rate is 18.00%/);
    });

    it('rejects a compound rate with zero components', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), { ...compoundDto, components: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an out-of-range component rate', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), {
          ...compoundDto,
          ratePercent: '109.00',
          components: [
            { componentName: 'CGST', componentRate: '9.00' },
            { componentName: 'SGST', componentRate: '100.00' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates for an authorized role', async () => {
      const { service, taxRateRepository } = buildService();
      await service.update(fixtureRequest('PROPERTY_MANAGER'), 't1', { name: 'VAT 16%' });
      expect(taxRateRepository.update).toHaveBeenCalledWith('t1', { name: 'VAT 16%', components: undefined });
    });

    it('rejects OUTLET_MANAGER', async () => {
      const { service } = buildService();
      await expect(
        service.update(fixtureRequest('OUTLET_MANAGER'), 't1', { name: 'VAT 16%' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for a missing tax rate', async () => {
      const { service, taxRateRepository } = buildService();
      (taxRateRepository.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.update(fixtureRequest(), 'missing', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('AC: rejects an out-of-range ratePercent on update too', async () => {
      const { service } = buildService();
      await expect(
        service.update(fixtureRequest(), 't1', { ratePercent: '101.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('the Active toggle can set isActive directly via update, mirroring Item\'s own precedent', async () => {
      const { service, taxRateRepository } = buildService();
      await service.update(fixtureRequest(), 't1', { isActive: false });
      expect(taxRateRepository.update).toHaveBeenCalledWith('t1', { isActive: false, components: undefined });
    });

    it('AC: switching a compound rate to simple clears its old components even without an explicit empty list', async () => {
      const compoundExisting = fixtureTaxRate({
        isCompound: true,
        ratePercent: '18.00',
        components: [
          { id: 'c1', taxRateId: 't1', componentName: 'CGST', componentRate: '9.00' },
          { id: 'c2', taxRateId: 't1', componentName: 'SGST', componentRate: '9.00' },
        ],
      });
      const { service, taxRateRepository } = buildService(compoundExisting);
      await service.update(fixtureRequest(), 't1', { isCompound: false, ratePercent: '5.00' });
      expect(taxRateRepository.update).toHaveBeenCalledWith('t1', {
        isCompound: false,
        ratePercent: '5.00',
        components: [],
      });
    });

    it('AC: editing components on an existing compound rate validates against the new sum', async () => {
      const compoundExisting = fixtureTaxRate({
        isCompound: true,
        ratePercent: '18.00',
        components: [
          { id: 'c1', taxRateId: 't1', componentName: 'CGST', componentRate: '9.00' },
          { id: 'c2', taxRateId: 't1', componentName: 'SGST', componentRate: '9.00' },
        ],
      });
      const { service } = buildService(compoundExisting);
      await expect(
        service.update(fixtureRequest(), 't1', {
          components: [
            { componentName: 'CGST', componentRate: '9.00' },
            { componentName: 'SGST', componentRate: '10.00' },
          ],
        }),
      ).rejects.toThrow(/Components sum to 19.00%, but the tax rate is 18.00%/);
    });
  });

  describe('deactivate', () => {
    it('AC: soft-deactivates (isActive: false), never hard-deletes', async () => {
      const { service, taxRateRepository } = buildService();
      await service.deactivate(fixtureRequest('PROPERTY_MANAGER'), 't1');
      expect(taxRateRepository.update).toHaveBeenCalledWith('t1', { isActive: false });
    });

    it('rejects OUTLET_MANAGER', async () => {
      const { service } = buildService();
      await expect(service.deactivate(fixtureRequest('OUTLET_MANAGER'), 't1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('list', () => {
    it('scopes by the caller\'s effectiveOutletIds and passes through isActive', async () => {
      const { service, taxRateRepository } = buildService();
      await service.list(fixtureRequest(), { isActive: 'true' });
      expect(taxRateRepository.findScoped).toHaveBeenCalledWith(
        expect.objectContaining({ accessibleOutletIds: ['o1'], isActive: true }),
      );
    });

    it('AC: omitting isActive queries without a filter (both active and inactive)', async () => {
      const { service, taxRateRepository } = buildService();
      await service.list(fixtureRequest(), {});
      expect(taxRateRepository.findScoped).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: undefined }),
      );
    });

    it('any role (including CHEF/STORE_STAFF) can list — read is not mutation-gated', async () => {
      const { service, taxRateRepository } = buildService();
      await service.list(fixtureRequest('CHEF'), {});
      expect(taxRateRepository.findScoped).toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('AC: computes a simple rate as a single lump amount', async () => {
      const { service } = buildService(fixtureTaxRate({ ratePercent: '15.00' }));
      const result = await service.preview(fixtureRequest(), 't1', '100.00');
      expect(result.lineTaxAmount).toBe('15.00');
      expect(result.lineTotal).toBe('115.00');
      expect(result.components).toEqual([]);
    });

    it('AC: computes a compound rate as an itemized breakdown that sums to lineTaxAmount', async () => {
      const compound = fixtureTaxRate({
        isCompound: true,
        ratePercent: '18.00',
        components: [
          { id: 'c1', taxRateId: 't1', componentName: 'CGST', componentRate: '9.00' },
          { id: 'c2', taxRateId: 't1', componentName: 'SGST', componentRate: '9.00' },
        ],
      });
      const { service } = buildService(compound);
      const result = await service.preview(fixtureRequest(), 't1', '200.00');
      expect(result.components).toEqual([
        { componentName: 'CGST', componentRate: '9.00', componentAmount: '18.00' },
        { componentName: 'SGST', componentRate: '9.00', componentAmount: '18.00' },
      ]);
      expect(result.lineTaxAmount).toBe('36.00');
      expect(result.lineTotal).toBe('236.00');
    });
  });
});
