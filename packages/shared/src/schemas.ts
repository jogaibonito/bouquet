import { z } from 'zod';
import { MAX_FILE_BYTES } from './constants.js';

export const uploadKind = z.enum(['photo', 'video']);
export type UploadKind = z.infer<typeof uploadKind>;

export const uploadStatus = z.enum(['pending', 'complete', 'failed', 'hidden', 'deleted']);
export type UploadStatus = z.infer<typeof uploadStatus>;

export const memberRole = z.enum(['owner', 'cohost', 'moderator']);
export type MemberRole = z.infer<typeof memberRole>;

export const storageBackend = z.enum(['google_drive', 'r2_overflow', 'fake']);
export type StorageBackend = z.infer<typeof storageBackend>;

/** Guest asks to upload; server decides whether Bloom allows it and mints a session. */
export const mintSessionRequest = z.object({
  eventSlug: z.string().min(1).max(80),
  files: z.array(z.object({
    filename: z.string().min(1).max(255),
    bytes: z.number().int().positive().max(MAX_FILE_BYTES),
    mimeType: z.string().min(1).max(120),
    kind: uploadKind,
  })).min(1).max(50),
});
export type MintSessionRequest = z.infer<typeof mintSessionRequest>;

export const mintedSession = z.object({
  uploadId: z.string(),
  sessionUrl: z.string().url(),
  chunkBytes: z.number().int().positive(),
  expiresAt: z.string().datetime(),
});
export type MintedSession = z.infer<typeof mintedSession>;

/** Partial grants are the norm under Bloom: some accepted, the rest deferred. */
export const mintSessionResponse = z.object({
  granted: z.array(mintedSession),
  deferred: z.array(z.object({ filename: z.string(), reason: z.enum(['bloom_limit']) })),
  quota: z.object({
    limited: z.boolean(),
    remaining: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    resetAt: z.string().datetime().nullable(),
  }),
});
export type MintSessionResponse = z.infer<typeof mintSessionResponse>;

export const completeUploadRequest = z.object({
  uploadId: z.string().min(1),
  providerFileId: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  thumbKey: z.string().min(1),
  previewKey: z.string().min(1).nullable(),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequest>;

export const failUploadRequest = z.object({
  uploadId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const guestbookEntryRequest = z.object({
  eventSlug: z.string().min(1),
  message: z.string().min(1).max(2000),
  uploadId: z.string().optional(),
});

export const reportRequest = z.object({
  uploadId: z.string().min(1),
  reason: z.enum(['inappropriate', 'not_mine', 'poor_quality', 'other']),
  detail: z.string().max(1000).optional(),
});

export const bloomConfig = z.object({
  enabled: z.boolean(),
  count: z.number().int().min(1).max(20),
  windowSeconds: z.number().int().min(300).max(21600),
  graceCount: z.number().int().min(0).max(50),
});
export type BloomConfig = z.infer<typeof bloomConfig>;

/** Env is validated at boundaries like everything else (CLAUDE.md conventions). */
export const serverEnv = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  GUEST_TOKEN_SECRET: z.string().min(32),
  STORAGE_PROVIDER: z.enum(['google_drive', 'fake']).default('fake'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});
export type ServerEnv = z.infer<typeof serverEnv>;
