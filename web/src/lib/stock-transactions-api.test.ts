import { describe, expect, it } from 'vitest';
import { isInboundTransactionType } from './stock-transactions-api';

describe('isInboundTransactionType', () => {
  it('treats every *_IN type as inbound', () => {
    expect(isInboundTransactionType('PURCHASE_IN')).toBe(true);
    expect(isInboundTransactionType('TRANSFER_IN')).toBe(true);
    expect(isInboundTransactionType('ADJUSTMENT_IN')).toBe(true);
  });

  it('AC: OPENING_BALANCE is treated as inbound despite not ending in _IN', () => {
    expect(isInboundTransactionType('OPENING_BALANCE')).toBe(true);
  });

  it('treats every *_OUT type as outbound', () => {
    expect(isInboundTransactionType('USAGE_OUT')).toBe(false);
    expect(isInboundTransactionType('WASTAGE_OUT')).toBe(false);
    expect(isInboundTransactionType('TRANSFER_OUT')).toBe(false);
    expect(isInboundTransactionType('ADJUSTMENT_OUT')).toBe(false);
  });
});
