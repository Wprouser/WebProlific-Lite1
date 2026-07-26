import { Injectable } from '@nestjs/common';
import { ExchangeRate as PrismaExchangeRate, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExchangeRate } from '../../domain/exchange-rate.entity';
import {
  CreateExchangeRateInput,
  ExchangeRateFilters,
  ExchangeRateRepository,
} from '../exchange-rate.repository';

function toDomain(row: PrismaExchangeRate): ExchangeRate {
  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    targetCurrency: row.targetCurrency,
    // .toFixed(6), not .toString() — matches Decimal(12,6) and the
    // project's fixed-precision-string convention elsewhere.
    rate: row.rate.toFixed(6),
    effectiveDate: row.effectiveDate,
    source: row.source as ExchangeRate['source'],
  };
}

@Injectable()
export class PrismaExchangeRateRepository implements ExchangeRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateExchangeRateInput): Promise<ExchangeRate> {
    const row = await this.prisma.exchangeRate.create({ data });
    return toDomain(row);
  }

  async findLatestPerPair(filters: ExchangeRateFilters): Promise<ExchangeRate[]> {
    const where: Prisma.ExchangeRateWhereInput = {
      ...(filters.baseCurrency && { baseCurrency: filters.baseCurrency }),
      ...(filters.targetCurrency && { targetCurrency: filters.targetCurrency }),
    };
    // distinct + orderBy: Prisma sorts first, then keeps the first row per
    // distinct (baseCurrency, targetCurrency) combination — i.e. exactly
    // the latest-by-effectiveDate row for each pair, in one query.
    const rows = await this.prisma.exchangeRate.findMany({
      where,
      orderBy: { effectiveDate: 'desc' },
      distinct: ['baseCurrency', 'targetCurrency'],
    });
    return rows.map(toDomain);
  }
}
