import { describe, it, expect } from 'vitest';
import { issueGuestToken, verifyGuestToken, hashToken, softFingerprint } from './session.js';

const SECRET = 'a'.repeat(48);
const EVENT = 'evt-123';

describe('guest session tokens', () => {
  it('round-trips a freshly issued token', () => {
    const { token } = issueGuestToken(EVENT, SECRET);
    expect(verifyGuestToken(token, EVENT, SECRET)?.token).toBe(token);
  });

  it('is unguessable — two issues never collide', () => {
    const seen = new Set(Array.from({ length: 500 }, () => issueGuestToken(EVENT, SECRET).token));
    expect(seen.size).toBe(500);
  });

  it('rejects a token minted for a different event', () => {
    const { token } = issueGuestToken(EVENT, SECRET);
    expect(verifyGuestToken(token, 'other-event', SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const { token } = issueGuestToken(EVENT, SECRET);
    const forged = `${token.slice(0, -4)}AAAA`;
    expect(verifyGuestToken(forged, EVENT, SECRET)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const { token } = issueGuestToken(EVENT, SECRET);
    expect(verifyGuestToken(token, EVENT, 'b'.repeat(48))).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', '...']) {
      expect(verifyGuestToken(bad, EVENT, SECRET)).toBeNull();
    }
  });

  it('stores a hash, never the token itself', () => {
    const { token, tokenHash } = issueGuestToken(EVENT, SECRET);
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).not.toContain(token);
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('fingerprints without retaining raw IP or UA', () => {
    const fp = softFingerprint('192.168.1.50', 'Mozilla/5.0 iPhone');
    expect(fp.ipHash).not.toContain('192.168');
    expect(fp.uaHash).not.toContain('iPhone');
    expect(softFingerprint('192.168.1.50', 'Mozilla/5.0 iPhone').ipHash).toBe(fp.ipHash);
  });
});
