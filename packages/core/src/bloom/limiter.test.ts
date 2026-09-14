import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type Redis from 'ioredis';
import { BloomLimiter, type BloomSettings } from './limiter.js';
import { testRedis, uniqueIds } from '../test/redis.js';

const EVENT = 'evt-bloom';
const GUEST = 'guest-1';

const settings = (over: Partial<BloomSettings> = {}): BloomSettings => ({
  enabled: true,
  count: 3,
  windowSeconds: 3600,
  graceCount: 0,
  ...over,
});

let redis: Redis;
let bloom: BloomLimiter;

beforeAll(() => {
  redis = testRedis();
  bloom = new BloomLimiter(redis);
});
afterAll(async () => { await redis.quit(); });
beforeEach(async () => { await bloom.reset(EVENT, GUEST); });

describe('BloomLimiter — allowance', () => {
  it('grants up to the limit and defers the rest in one call', async () => {
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(10), settings: settings(),
    });
    expect(r.grantedIds).toHaveLength(3);
    expect(r.deferredIds).toHaveLength(7);
    expect(r.remaining).toBe(0);
  });

  it('never rejects outright — a partial grant is always returned', async () => {
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(2), settings: settings() });
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(5), settings: settings(),
    });
    expect(r.grantedIds).toHaveLength(1);
    expect(r.deferredIds).toHaveLength(4);
  });

  it('reports resetAt only once the window is full', async () => {
    const partial = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(2), settings: settings(),
    });
    expect(partial.resetAt).toBeNull();

    const full = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(1), settings: settings(),
    });
    expect(full.resetAt).toBeInstanceOf(Date);
  });
});

describe('BloomLimiter — rolling window', () => {
  it('frees slots gradually, not all at once on the hour', async () => {
    const t0 = Date.now();
    // Three uploads spread across the hour.
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(1), settings: settings(), now: t0 });
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(1), settings: settings(), now: t0 + 20 * 60_000 });
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(1), settings: settings(), now: t0 + 40 * 60_000 });

    // At t0 + 61min only the first has aged out — exactly one slot back.
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(3), settings: settings(),
      now: t0 + 61 * 60_000,
    });
    expect(r.grantedIds).toHaveLength(1);
    expect(r.deferredIds).toHaveLength(2);
  });

  it('restores the full allowance once the whole window has passed', async () => {
    const t0 = Date.now();
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(3), settings: settings(), now: t0 });
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(3), settings: settings(),
      now: t0 + 3601_000,
    });
    expect(r.grantedIds).toHaveLength(3);
  });
});

describe('BloomLimiter — concurrency (the reason for the Lua script)', () => {
  it('grants exactly the limit when 20 single-file requests race', async () => {
    const ids = uniqueIds(20);
    const results = await Promise.all(
      ids.map((id) => bloom.reserve({
        eventId: EVENT, guestSessionId: GUEST, uploadIds: [id], settings: settings(),
      })),
    );
    const granted = results.flatMap((r) => r.grantedIds);
    expect(granted).toHaveLength(3);
    expect(new Set(granted).size).toBe(3);
  });

  it('holds under a burst of multi-file requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => bloom.reserve({
        eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(5), settings: settings({ count: 7 }),
      })),
    );
    expect(results.flatMap((r) => r.grantedIds)).toHaveLength(7);
  });

  it('isolates guests from one another', async () => {
    const [a, b] = await Promise.all([
      bloom.reserve({ eventId: EVENT, guestSessionId: 'guest-a', uploadIds: uniqueIds(3), settings: settings() }),
      bloom.reserve({ eventId: EVENT, guestSessionId: 'guest-b', uploadIds: uniqueIds(3), settings: settings() }),
    ]);
    expect(a!.grantedIds).toHaveLength(3);
    expect(b!.grantedIds).toHaveLength(3);
    await bloom.reset(EVENT, 'guest-a');
    await bloom.reset(EVENT, 'guest-b');
  });
});

describe('BloomLimiter — release', () => {
  it('returns a slot when an upload fails', async () => {
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(3), settings: settings(),
    });
    expect(r.remaining).toBe(0);

    await bloom.release(EVENT, GUEST, r.grantedIds[0]!);

    const after = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(2), settings: settings(),
    });
    expect(after.grantedIds).toHaveLength(1);
  });

  it('is idempotent — a double release cannot mint free slots', async () => {
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(3), settings: settings(),
    });
    const id = r.grantedIds[0]!;
    await bloom.release(EVENT, GUEST, id);
    await bloom.release(EVENT, GUEST, id);
    await bloom.release(EVENT, GUEST, id);

    const after = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(5), settings: settings(),
    });
    expect(after.grantedIds.length).toBeLessThanOrEqual(3);
  });
});

describe('BloomLimiter — grace and bypass', () => {
  it("never rejects a guest's first interaction", async () => {
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(5),
      settings: settings({ count: 3, graceCount: 5 }),
    });
    expect(r.grantedIds).toHaveLength(5);
  });

  it('falls back to the window once grace is spent', async () => {
    const s = settings({ count: 3, graceCount: 5 });
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(5), settings: s });
    const r = await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(10), settings: s });
    expect(r.grantedIds).toHaveLength(3);
  });

  it('spans the grace boundary in a single request', async () => {
    const s = settings({ count: 3, graceCount: 5 });
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(3), settings: s });
    // 2 grace left + 3 window slots = 5 of the 10 requested.
    const r = await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(10), settings: s });
    expect(r.grantedIds).toHaveLength(5);
  });

  it('leaves no footprint for boosted guests', async () => {
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(50), settings: settings(), bypass: true,
    });
    expect(r.grantedIds).toHaveLength(50);
    expect(r.limited).toBe(false);
    const peek = await bloom.peek(EVENT, GUEST, settings());
    expect(peek.used).toBe(0);
  });

  it('is inert when Bloom is disabled', async () => {
    const r = await bloom.reserve({
      eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(99), settings: settings({ enabled: false }),
    });
    expect(r.grantedIds).toHaveLength(99);
    expect(r.limited).toBe(false);
  });
});

describe('BloomLimiter — housekeeping', () => {
  it('expires its own keys so the event leaves no residue', async () => {
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(1), settings: settings() });
    const ttl = await redis.pttl(`bloom:w:{${EVENT}:${GUEST}}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600_000 + 60_000);
  });

  it('peek matches reserve without mutating state', async () => {
    await bloom.reserve({ eventId: EVENT, guestSessionId: GUEST, uploadIds: uniqueIds(2), settings: settings() });
    const a = await bloom.peek(EVENT, GUEST, settings());
    const b = await bloom.peek(EVENT, GUEST, settings());
    expect(a.remaining).toBe(1);
    expect(b.remaining).toBe(1);
    expect(b.used).toBe(2);
  });
});
