import Redis from 'ioredis';
import { createDb } from '@bouquet/db';
import { BloomLimiter, UploadService, FakeStorageProvider, GoogleDriveProvider, type StorageProvider } from '@bouquet/core';

/**
 * Module-scoped singletons. Next.js route handlers are stateless per request but
 * the process is long-lived, so connection pools must not be rebuilt per call.
 */
let cached: { redis: Redis; db: ReturnType<typeof createDb>; service: UploadService } | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export function server() {
  if (cached) return cached;

  const redis = new Redis(requireEnv('REDIS_URL'));
  const db = createDb(requireEnv('DATABASE_URL'));
  const bloom = new BloomLimiter(redis);

  // STORAGE_PROVIDER=fake lets the whole upload path run without Google creds.
  const primary: StorageProvider =
    process.env.STORAGE_PROVIDER === 'google_drive'
      ? new GoogleDriveProvider({ getAccessToken: async () => requireEnv('GOOGLE_ACCESS_TOKEN') })
      : new FakeStorageProvider(
          15 * 1024 ** 3,
          `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/dev/upload`,
        );

  const service = new UploadService({ db: db.db, bloom, primary });
  cached = { redis, db, service };
  return cached;
}

export const GUEST_COOKIE = 'bq_guest';
