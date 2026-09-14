/** Upload chunk size. CLAUDE.md: venue wifi is bad; small chunks resume cheaply. */
export const UPLOAD_CHUNK_BYTES = 256 * 1024;

/** Ceiling per file, matching the "1GB videos" product promise. */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/** Derived asset sizing. Originals are never re-encoded (invariant 5). */
export const THUMB_MAX_EDGE = 400;
export const PREVIEW_MAX_HEIGHT = 720;

/** A minted Drive session is useless to an attacker for long. */
export const UPLOAD_SESSION_TTL_SECONDS = 60 * 30;

/** Host warned at 85% of Drive quota, failed over to R2 at 95%. */
export const QUOTA_WARN_RATIO = 0.85;
export const QUOTA_FAILOVER_RATIO = 0.95;

/** Storage estimate shown during event setup (PLAN.md "Storage quota"). */
export const ESTIMATE_PHOTOS_PER_GUEST = 15;
export const ESTIMATE_PHOTO_BYTES = 4 * 1024 * 1024;
export const ESTIMATE_VIDEOS_PER_GUEST = 2;
export const ESTIMATE_VIDEO_BYTES = 80 * 1024 * 1024;

export const BLOOM_PRESETS = {
  relaxed:  { count: 10, windowSeconds: 3600 },
  balanced: { count: 5,  windowSeconds: 3600 },
  trickle:  { count: 3,  windowSeconds: 3600 },
} as const;

export type BloomPreset = keyof typeof BLOOM_PRESETS;

/** First N uploads bypass Bloom entirely: a guest's first act is never a rejection. */
export const DEFAULT_BLOOM_GRACE = 5;
