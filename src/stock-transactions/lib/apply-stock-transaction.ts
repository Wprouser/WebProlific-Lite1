import { Prisma, StockTransaction as PrismaStockTransaction } from '@prisma/client';
import { TRANSACTION_DIRECTION, TransactionType } from '../constants/enums';

/**
 * Core "insert a StockTransaction row + update Item.currentStock" logic,
 * factored out of PrismaStockTransactionRepository so it can also be called
 * from PrismaItemRepository.create (FR-01's opening-stock capture) inside
 * that same repository's own `prisma.$transaction`, without either module
 * depending on the other's NestJS module/service (StockTransactionsModule
 * already imports ItemsModule — importing it back would be a DI cycle; this
 * is a plain function import instead, so there's nothing for Nest to cycle
 * on). Deliberately takes the caller's already-known `currentStock` rather
 * than re-reading the Item row itself — PrismaStockTransactionRepository
 * still does its own locked read first (see that file), and
 * PrismaItemRepository already has the just-created Item row in hand.
 */
export interface ApplyStockTransactionInput {
  outletId: string;
  itemId: string;
  type: TransactionType;
  quantity: string;
  currentStock: Prisma.Decimal;
  referenceType: string | null;
  referenceId: string | null;
  reasonCode: string | null;
  performedById: string;
  allowNegativeBalance: boolean;
}

export type ApplyStockTransactionOutcome =
  | { ok: true; transaction: PrismaStockTransaction; balanceAfter: Prisma.Decimal }
  | { ok: false; reason: 'INSUFFICIENT_STOCK'; balanceAfter: Prisma.Decimal };

export async function applyStockTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyStockTransactionInput,
): Promise<ApplyStockTransactionOutcome> {
  const direction = TRANSACTION_DIRECTION[input.type];
  const delta = new Prisma.Decimal(input.quantity).mul(direction);
  const balanceAfter = input.currentStock.plus(delta);

  if (balanceAfter.lessThan(0) && !input.allowNegativeBalance) {
    return { ok: false, reason: 'INSUFFICIENT_STOCK', balanceAfter };
  }

  const transaction = await tx.stockTransaction.create({
    data: {
      outletId: input.outletId,
      itemId: input.itemId,
      type: input.type,
      quantity: input.quantity,
      balanceAfter: balanceAfter.toFixed(3),
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reasonCode: input.reasonCode,
      performedById: input.performedById,
    },
  });

  await tx.item.update({
    where: { id: input.itemId },
    data: { currentStock: balanceAfter.toFixed(3) },
  });

  return { ok: true, transaction, balanceAfter };
}
