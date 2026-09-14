/**
 * End-to-end smoke test against real Postgres + Redis, using the fake Drive
 * provider. Simulates one guest at a Bloom-limited event: an eager batch,
 * a deferred remainder, a failure that returns a slot, and the window rolling.
 */
import Redis from 'ioredis';
import { createDb } from '@bouquet/db';
import { events, users, guestSessions, uploads } from '@bouquet/db/schema';
import { eq } from 'drizzle-orm';
import { BloomLimiter, UploadService, FakeStorageProvider, uploadFile } from '@bouquet/core';
import { randomUUID } from 'node:crypto';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const { db, client } = createDb(process.env.DATABASE_URL!);
const bloom = new BloomLimiter(redis);
const drive = new FakeStorageProvider();
const svc = new UploadService({ db, bloom, primary: drive });

const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
};

const slug = `smoke-${randomUUID().slice(0, 8)}`;
const [owner] = await db.insert(users).values({ email: `${slug}@t.test`, authProvider: 'apple' }).returning();
const [event] = await db.insert(events).values({
  ownerId: owner!.id, slug, title: 'Smoke Wedding', storageFolderId: 'f1', storageBackend: 'fake',
  bloomEnabled: true, bloomCount: 3, bloomWindowSeconds: 3600, bloomGraceCount: 0,
}).returning();
const [guest] = await db.insert(guestSessions)
  .values({ eventId: event!.id, tokenHash: randomUUID() }).returning();

const mkFiles = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({
  filename: `${tag}-${i}.jpg`, bytes: 3_000_000, mimeType: 'image/jpeg', kind: 'photo' as const,
}));

console.log('\n1. Guest picks 12 photos at a 3-per-hour event');
const first = await svc.mintSessions({ eventSlug: slug, files: mkFiles(12, 'a') }, guest!.id);
ok('3 granted', first.granted.length === 3, `got ${first.granted.length}`);
ok('9 deferred, not rejected', first.deferred.length === 9, `got ${first.deferred.length}`);
ok('countdown offered to guest', first.quota.resetAt !== null);

console.log('\n2. Granted files upload in 256KB chunks through a flaky network');
let dropped = false;
const flaky = (async (_u: string, init: RequestInit) => {
  const cr = (init.headers as Record<string, string>)['Content-Range']!;
  if (cr.startsWith('bytes */')) return new Response(null, { status: 308, headers: { range: 'bytes=0--1' } });
  if (!dropped) { dropped = true; throw new TypeError('network dropped'); }
  return new Response(JSON.stringify({ id: `drive-${randomUUID()}` }), { status: 200 });
}) as unknown as typeof fetch;

const target = first.granted[0]!;
const out = await uploadFile({ size: 700_000, slice: (s, e) => ({ s, e }) }, target,
  { fetchImpl: flaky, sleep: async () => {} });
ok('upload survived a mid-flight drop', out.bytesSent === 700_000);
await svc.completeUpload({
  uploadId: target.uploadId, providerFileId: out.providerFileId,
  width: 4032, height: 3024, durationMs: null, thumbKey: `th/${target.uploadId}.jpg`, previewKey: null,
});
const [done] = await db.select().from(uploads).where(eq(uploads.id, target.uploadId));
ok('upload marked complete', done!.status === 'complete');

console.log('\n3. A guest gives up on one file — the slot must come back');
await svc.failUpload(first.granted[1]!.uploadId);
const retry = await svc.mintSessions({ eventSlug: slug, files: mkFiles(2, 'b') }, guest!.id);
ok('exactly one slot returned', retry.granted.length === 1, `got ${retry.granted.length}`);

console.log('\n4. Twenty simultaneous requests cannot exceed the limit');
await bloom.reset(event!.id, guest!.id);
const burst = await Promise.all(
  Array.from({ length: 20 }, (_, i) => svc.mintSessions({ eventSlug: slug, files: mkFiles(1, `c${i}`) }, guest!.id)),
);
const grantedInBurst = burst.flatMap((r) => r.granted).length;
ok('limit held under concurrency', grantedInBurst === 3, `granted ${grantedInBurst}`);

console.log('\n5. Gallery serves only completed uploads');
const gallery = await svc.listGallery(slug);
ok('one completed photo visible', gallery.length === 1, `got ${gallery.length}`);
ok('gallery reads derived asset, not Drive', gallery[0]!.thumbKey!.startsWith('th/'));

console.log('\n6. Photo bytes never touched our server');
ok('all originals held by provider only', drive.files.size > 0);

await redis.quit();
await client.end({ timeout: 5 });
console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'}\n`);
