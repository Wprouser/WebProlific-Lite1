import { ReasonCode, ReferenceType, TransactionType } from '../constants/enums';

export interface StockTransaction {
  id: string;
  outletId: string;
  itemId: string;
  type: TransactionType;
  quantity: string;
  balanceAfter: string;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  reasonCode: ReasonCode | null;
  photoUrl: string | null;
  // Null for system-performed movements — FR-06's POS deductions are
  // authenticated by webhook signature, not by a user session.
  performedById: string | null;
  createdAt: Date;
}
