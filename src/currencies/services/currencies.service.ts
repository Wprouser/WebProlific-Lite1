import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CURRENCY_REPOSITORY } from '../repositories/tokens';
import { CurrencyRepository } from '../repositories/currency.repository';
import { Currency } from '../domain/currency.entity';

@Injectable()
export class CurrenciesService {
  constructor(@Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository) {}

  list(): Promise<Currency[]> {
    return this.currencyRepository.findAll();
  }

  async getOrThrow(code: string): Promise<Currency> {
    const currency = await this.currencyRepository.findByCode(code);
    if (!currency) throw new NotFoundException(`Currency ${code} not found`);
    return currency;
  }
}
