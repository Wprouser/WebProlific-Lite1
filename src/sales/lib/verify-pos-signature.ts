import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * FR-06 Model 1: the POS webhook is server-to-server, so it can't carry a
 * user's JWT. Authentication is a shared-secret HMAC over the request body,
 * which is the standard shape every POS vendor already implements (Stripe,
 * Square, Toast all sign this way).
 *
 * Pure and dependency-free on purpose — no Nest, no config, no request
 * object — so the comparison logic can be tested exhaustively without an
 * HTTP layer, and so the guard above it stays a thin adapter.
 */

export const POS_SIGNATURE_HEADER = 'x-pos-signature';

/** Lowercase hex SHA-256 HMAC of the raw body. */
export function signPayload(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time comparison of a presented signature against the expected
 * one. Returns false rather than throwing for every failure mode — a
 * missing header, a malformed hex string, and a wrong signature are all
 * simply "not authenticated", and distinguishing them in the response would
 * hand an attacker a probing oracle.
 *
 * `timingSafeEqual` throws on length mismatch, so the length is checked
 * first; that leaks only the signature's length, which is fixed and public
 * (64 hex chars for SHA-256) and therefore reveals nothing.
 */
export function verifyPosSignature(
  rawBody: string | Buffer,
  presentedSignature: string | undefined,
  secret: string,
): boolean {
  if (!presentedSignature || !secret) return false;

  const expected = Buffer.from(signPayload(rawBody, secret), 'utf8');
  const presented = Buffer.from(presentedSignature.trim().toLowerCase(), 'utf8');
  if (expected.length !== presented.length) return false;

  return timingSafeEqual(expected, presented);
}
