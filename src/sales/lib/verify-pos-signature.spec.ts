import { POS_SIGNATURE_HEADER, signPayload, verifyPosSignature } from './verify-pos-signature';

const SECRET = 'pos-shared-secret';
const BODY = JSON.stringify({ posReferenceId: 'pos-txn-1', menuItemId: 'm1', quantitySold: 2 });

describe('verifyPosSignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyPosSignature(BODY, signPayload(BODY, SECRET), SECRET)).toBe(true);
  });

  it('accepts an uppercase signature (hex case carries no meaning)', () => {
    expect(verifyPosSignature(BODY, signPayload(BODY, SECRET).toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyPosSignature(BODY, signPayload(BODY, 'other-secret'), SECRET)).toBe(false);
  });

  it('AC: rejects a body that changed after signing — this is the whole point', () => {
    const signature = signPayload(BODY, SECRET);
    const tampered = JSON.stringify({ posReferenceId: 'pos-txn-1', menuItemId: 'm1', quantitySold: 200 });
    expect(verifyPosSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('signs over raw bytes, so byte-identical re-serialization is required', () => {
    // Same JSON *value*, different byte string (a space after the colon).
    const reserialized = '{"posReferenceId": "pos-txn-1","menuItemId": "m1","quantitySold": 2}';
    expect(verifyPosSignature(reserialized, signPayload(BODY, SECRET), SECRET)).toBe(false);
  });

  it('accepts a Buffer body identically to the equivalent string', () => {
    expect(verifyPosSignature(Buffer.from(BODY, 'utf8'), signPayload(BODY, SECRET), SECRET)).toBe(true);
  });

  it('returns false rather than throwing for a missing or malformed signature', () => {
    expect(verifyPosSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyPosSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyPosSignature(BODY, 'not-hex', SECRET)).toBe(false);
    // A length mismatch would make timingSafeEqual throw if unguarded.
    expect(verifyPosSignature(BODY, 'ab'.repeat(10), SECRET)).toBe(false);
  });

  it('returns false when no secret is configured — never fails open', () => {
    expect(verifyPosSignature(BODY, signPayload(BODY, ''), '')).toBe(false);
  });

  it('exposes the header name it expects, so the guard and docs cannot drift', () => {
    expect(POS_SIGNATURE_HEADER).toBe('x-pos-signature');
  });
});
