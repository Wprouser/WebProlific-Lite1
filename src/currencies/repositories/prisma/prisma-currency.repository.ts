import { Injectable } from '@nestjs/common';
import { Currency as PrismaCurrency } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Currency } from '../../domain/currency.entity';
import { CurrencyRepository } from '../currency.repository';

function toDomain(row: PrismaCurrency): Currency {
  return {
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    decimalPlaces: row.decimalPlaces,
  };
}

@Injectable()
export class PrismaCurrencyRepository implements CurrencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Currency[]> {
    const rows = await this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
    return rows.map(toDomain);
  }

  async findByCode(code: string): Promise<Currency | null> {
    const row = await this.prisma.currency.findUnique({ where: { code } });
    return row ? toDomain(row) : null;
  }

  async create(data: Currency): Promise<Currency> {
    const row = await this.prisma.currency.create({ data });
    return toDomain(row);
  }
}
