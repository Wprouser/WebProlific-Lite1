import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OUTLET_REPOSITORY, PROPERTY_REPOSITORY } from '../repositories/tokens';
import { OutletRepository } from '../repositories/outlet.repository';
import { PropertyRepository } from '../repositories/property.repository';
import { Outlet } from '../domain/outlet.entity';
import { OutletCurrencySettings } from '../domain/outlet-currency-settings.entity';
import { CreateOutletDto } from '../dto/create-outlet.dto';
import { UpdateOutletDto } from '../dto/update-outlet.dto';
import { UpdateCurrencySettingsDto } from '../dto/update-currency-settings.dto';
import { OUTLET_CREATED_EVENT, OutletCreatedEvent } from '../events/outlet-created.event';
import { CurrenciesService } from '../../currencies/services/currencies.service';
import { STOCK_TRANSACTION_REPOSITORY } from '../../stock-transactions/repositories/tokens';
import { StockTransactionRepository } from '../../stock-transactions/repositories/stock-transaction.repository';

@Injectable()
export class OutletsService {
  constructor(
    @Inject(OUTLET_REPOSITORY) private readonly outletRepository: OutletRepository,
    @Inject(PROPERTY_REPOSITORY)
    private readonly propertyRepository: PropertyRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly currenciesService: CurrenciesService,
    @Inject(STOCK_TRANSACTION_REPOSITORY)
    private readonly stockTransactionRepository: StockTransactionRepository,
  ) {}

  async create(propertyId: string, dto: CreateOutletDto): Promise<Outlet> {
    const property = await this.propertyRepository.findById(propertyId);
    if (!property) throw new NotFoundException(`Property ${propertyId} not found`);
    if (dto.baseCurrency) await this.currenciesService.getOrThrow(dto.baseCurrency);
    // chainId is denormalized from property.chainId — never accepted from the client (spec: FR-00 note).
    const outlet = await this.outletRepository.create({
      propertyId,
      chainId: property.chainId,
      ...dto,
    });
    // tenancy doesn't know items/Category exists — whoever cares about a
    // freshly created outlet (today: FR-01 seeding default categories)
    // listens for this instead of tenancy depending on them. emitAsync +
    // await so the seed is guaranteed done before create() returns, same
    // reasoning as ActivityBus.
    const event: OutletCreatedEvent = { outletId: outlet.id, baseCurrency: outlet.baseCurrency };
    await this.eventEmitter.emitAsync(OUTLET_CREATED_EVENT, event);
    return outlet;
  }

  async findById(id: string): Promise<Outlet> {
    const outlet = await this.outletRepository.findById(id);
    if (!outlet) throw new NotFoundException(`Outlet ${id} not found`);
    return outlet;
  }

  async update(id: string, dto: UpdateOutletDto): Promise<Outlet> {
    await this.findById(id);
    return this.outletRepository.update(id, dto);
  }

  async getCurrencySettings(id: string): Promise<OutletCurrencySettings> {
    const outlet = await this.findById(id);
    const currencies = await this.currenciesService.list();
    return { baseCurrency: outlet.baseCurrency, supportedCurrencies: currencies.map((c) => c.code) };
  }

  async updateCurrencySettings(id: string, dto: UpdateCurrencySettingsDto): Promise<OutletCurrencySettings> {
    await this.findById(id);
    await this.currenciesService.getOrThrow(dto.baseCurrency);

    // FR-16 business rule: once the outlet has any transactional history,
    // changing its base currency would invalidate historical valuation
    // reporting — blocked outright, not just discouraged. PurchaseOrder/GRN
    // don't exist in this codebase yet (FR-03/04 not built), so only
    // StockTransaction is checked today; extend this alongside PO/GRN once
    // they land.
    const hasHistory = await this.stockTransactionRepository.existsForOutlet(id);
    if (hasHistory) {
      throw new ConflictException(
        "Base currency can't be changed once transactions exist — contact support if this needs correcting.",
      );
    }

    const outlet = await this.outletRepository.update(id, { baseCurrency: dto.baseCurrency });
    const currencies = await this.currenciesService.list();
    return { baseCurrency: outlet.baseCurrency, supportedCurrencies: currencies.map((c) => c.code) };
  }
}
