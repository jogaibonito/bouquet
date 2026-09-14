import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Redis from 'ioredis';
import { UploadService, EventNotFoundError } from './service.js';
import { BloomLimiter } from '../bloom/limiter.js';
import { FakeStorageProvider } from '../storage/fake.js';
import type { StorageProvider } from '../storage/provider.js';
import { testRedis } from '../test/redis.js';
import { testDb, seedEvent, seedGuest, file } from '../test/db.js';
import { uploads } from '@bouquet/db/schema';
import { eq } from 'drizzle-orm';

let redis: Redis;
let handle: ReturnType<typeof testDb>;
let bloom: BloomLimiter;

beforeAll(() => {
  redis = testRedis();
  handle = testDb();
  bloom = new BloomLimiter(redis);
});
afterAll(async () => { await redis.quit(); await handle.client.end({ timeout: 5 }); });

const service = (primary: StorageProvider, overflow?: StorageProvider) =>
  new UploadService({ db: handle.db, bloom, primary, overflow });

describe('UploadService — minting', () => {
  it('mints a session per file when Bloom is off', async () => {
    const { event } = await seedEvent(handle.db);
    const guest = await seedGuest(handle.db, event.id);
    const res = await service(new FakeStorageProvider())
      .mintSessions({ eventSlug: event.slug, files: [file('a.jpg'), file('b.jpg')] }, guest.id);

    expect(res.granted).toHaveLength(2);
    expect(res.deferred).toHaveLength(0);
    expect(res.granted[0]!.sessionUrl).toMatch(/^https:\/\//);
    expect(res.granted[0]!.chunkBytes).toBe(256 * 1024);
  });

  it('writes a pending upload row per granted file', async () => {
    const { event } = await seedEvent(handle.db);
    const guest = await seedGuest(handle.db, event.id);
    const res = await service(new FakeStorageProvider())
      .mintSessions({ eventSlug: event.slug, files: [file('c.jpg')] }, guest.id);

    const [row] = await handle.db.select().from(uploads).where(eq(uploads.id, res.granted[0]!.uploadId));
    expect(row!.status).toBe('pending');
    expect(row!.filename).toBe('c.jpg');
  });

  it('rejects an unknown event slug', async () => {
    const { event } = await seedEvent(handle.db);
    const guest = await seedGuest(handle.db, event.id);
    await expect(
      service(new FakeStorageProvider()).mintSessions({ eventSlug: 'nope', files: [file('a.jpg')] }, guest.id),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe('UploadService — Bloom integration', () => {
  it('defers the overflow rather than rejecting the batch', async () => {
    const { event } = await seedEvent(handle.db, { bloomEnabled: true, bloomCount: 3 });
    const guest = await seedGuest(handle.db, event.id);
    const files = Array.from({ length: 15 }, (_, i) => file(`p${i}.jpg`));

    const res = await service(new FakeStorageProvider())
      .mintSessions({ eventSlug: event.slug, files }, guest.id);

    expect(res.granted).toHaveLength(3);
    expect(res.deferred).toHaveLength(12);
    expect(res.quota).toMatchObject({ limited: true, remaining: 0, limit: 3 });
    expect(res.quota.resetAt).not.toBeNull();
  });

  it('lets boosted guests past without consuming allowance', async () => {
    const { event } = await seedEvent(handle.db, { bloomEnabled: true, bloomCount: 3 });
    const guest = await seedGuest(handle.db, event.id, { isBoosted: true });
    const files = Array.from({ length: 20 }, (_, i) => file(`b${i}.jpg`));

    const res = await service(new FakeStorageProvider())
      .mintSessions({ eventSlug: event.slug, files }, guest.id);
    expect(res.granted).toHaveLength(20);
    expect(res.quota.limited).toBe(false);
  });

  it('holds the limit when one guest fires concurrent batches', async () => {
    const { event } = await seedEvent(handle.db, { bloomEnabled: true, bloomCount: 4 });
    const guest = await seedGuest(handle.db, event.id);
    const svc = service(new FakeStorageProvider());

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, b) =>
        svc.mintSessions({ eventSlug: event.slug, files: [file(`x${b}.jpg`), file(`y${b}.jpg`)] }, guest.id)),
    );
    expect(results.flatMap((r) => r.granted)).toHaveLength(4);
  });
});

describe('UploadService — failure returns the slot', () => {
  it('releases the Bloom slot when the provider errors', async () => {
    const { event } = await seedEvent(handle.db, { bloomEnabled: true, bloomCount: 3 });
    const guest = await seedGuest(handle.db, event.id);

    const broken: StorageProvider = {
      backend: 'fake',
      createResumableSession: async () => { throw new Error('Drive 503'); },
      getQuota: async () => ({ limitBytes: null, usedBytes: 0, get freeBytes() { return 1e15; } }),
      deleteFile: async () => {},
    };

    const failed = await service(broken)
      .mintSessions({ eventSlug: event.slug, files: [file('a.jpg'), file('b.jpg')] }, guest.id);
    expect(failed.granted).toHaveLength(0);

    // Allowance must be intact — the guest lost nothing to a provider outage.
    const res = await service(new FakeStorageProvider())
      .mintSessions({ eventSlug: event.slug, files: Array.from({ length: 3 }, (_, i) => file(`r${i}.jpg`)) }, guest.id);
    expect(res.granted).toHaveLength(3);
  });

  it('returns the slot when the client reports a give-up', async () => {
    const { event } = await seedEvent(handle.db, { bloomEnabled: true, bloomCount: 2 });
    const guest = await seedGuest(handle.db, event.id);
    const svc = service(new FakeStorageProvider());

    const first = await svc.mintSessions(
      { eventSlug: event.slug, files: [file('a.jpg'), file('b.jpg')] }, guest.id);
    expect(first.granted).toHaveLength(2);

    await svc.failUpload(first.granted[0]!.uploadId);

    const second = await svc.mintSessions({ eventSlug: event.slug, files: [file('c.jpg')] }, guest.id);
    expect(second.granted).toHaveLength(1);
  });

  it('ignores a give-up for an already-completed upload', async () => {
    const { event } = await seedEvent(handle.db, { bloomEnabled: true, bloomCount: 2 });
    const guest = await seedGuest(handle.db, event.id);
    const svc = service(new FakeStorageProvider());

    const res = await svc.mintSessions({ eventSlug: event.slug, files: [file('a.jpg')] }, guest.id);
    const id = res.granted[0]!.uploadId;
    await svc.completeUpload({
      uploadId: id, providerFileId: 'drive-1', width: 4000, height: 3000,
      durationMs: null, thumbKey: 'th/1.jpg', previewKey: null,
    });
    await svc.failUpload(id);

    const [row] = await handle.db.select().from(uploads).where(eq(uploads.id, id));
    expect(row!.status).toBe('complete');
  });
});

describe('UploadService — quota failover', () => {
  it('routes to overflow when the host Drive is effectively full', async () => {
    const { event } = await seedEvent(handle.db);
    const guest = await seedGuest(handle.db, event.id);

    const full = new FakeStorageProvider(15 * 1024 ** 3);
    full.setUsed(14.8 * 1024 ** 3);
    const overflow = new FakeStorageProvider(null);

    const res = await service(full, overflow)
      .mintSessions({ eventSlug: event.slug, files: [file('big.mp4', 80_000_000)] }, guest.id);

    expect(res.granted).toHaveLength(1);
    expect(overflow.files.size).toBe(1);
    expect(full.files.size).toBe(0);
  });

  it('never fails a guest upload because quota lookup broke', async () => {
    const { event } = await seedEvent(handle.db);
    const guest = await seedGuest(handle.db, event.id);

    const flaky = new FakeStorageProvider();
    flaky.getQuota = async () => { throw new Error('Drive quota API down'); };

    const res = await service(flaky, new FakeStorageProvider(null))
      .mintSessions({ eventSlug: event.slug, files: [file('a.jpg')] }, guest.id);
    expect(res.granted).toHaveLength(1);
  });
});

describe('UploadService — gallery', () => {
  it('returns only completed uploads, newest first', async () => {
    const { event } = await seedEvent(handle.db);
    const guest = await seedGuest(handle.db, event.id);
    const svc = service(new FakeStorageProvider());

    const res = await svc.mintSessions(
      { eventSlug: event.slug, files: [file('one.jpg'), file('two.jpg')] }, guest.id);

    await svc.completeUpload({
      uploadId: res.granted[0]!.uploadId, providerFileId: 'd1', width: 100, height: 100,
      durationMs: null, thumbKey: 'th/one.jpg', previewKey: null,
    });

    const gallery = await svc.listGallery(event.slug);
    expect(gallery).toHaveLength(1);
    expect(gallery[0]!.thumbKey).toBe('th/one.jpg');
  });
});
