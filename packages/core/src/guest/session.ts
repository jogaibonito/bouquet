import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Invariant 2: guests never authenticate. Identity is an opaque signed token,
 * stored in localStorage AND an httpOnly cookie because iOS evicts localStorage
 * under storage pressure. We store only the hash, never the token.
 */
export interface GuestToken {
  token: string;
  tokenHash: string;
}

const b64url = (b: Buffer) => b.toString('base64url');

export function issueGuestToken(eventId: string, secret: string): GuestToken {
  const nonce = b64url(randomBytes(24));
  const payload = `${eventId}.${nonce}`;
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  const token = `${payload}.${sig}`;
  return { token, tokenHash: hashToken(token) };
}

export function verifyGuestToken(token: string, eventId: string, secret: string): GuestToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [tokenEventId, nonce, sig] = parts as [string, string, string];
  if (tokenEventId !== eventId) return null;

  const expected = b64url(createHmac('sha256', secret).update(`${tokenEventId}.${nonce}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { token, tokenHash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Soft signal only. CLAUDE.md: never block on this — a false positive at a
 * wedding costs far more than an extra upload from an incognito tab.
 */
export const softFingerprint = (ip: string, userAgent: string) => ({
  ipHash: createHash('sha256').update(ip).digest('hex').slice(0, 32),
  uaHash: createHash('sha256').update(userAgent).digest('hex').slice(0, 32),
});
