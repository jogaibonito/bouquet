import {
  QUOTA_WARN_RATIO, QUOTA_FAILOVER_RATIO,
  ESTIMATE_PHOTOS_PER_GUEST, ESTIMATE_PHOTO_BYTES,
  ESTIMATE_VIDEOS_PER_GUEST, ESTIMATE_VIDEO_BYTES,
} from '@bouquet/shared';
import type { QuotaInfo } from './provider.js';

export type QuotaState = 'ok' | 'warn' | 'failover';

/** PLAN.md: warn the host at 85%, fail over to R2 at 95%. Never fail the guest. */
export function quotaState(q: QuotaInfo): QuotaState {
  if (q.limitBytes === null) return 'ok';
  const ratio = q.usedBytes / q.limitBytes;
  if (ratio >= QUOTA_FAILOVER_RATIO) return 'failover';
  if (ratio >= QUOTA_WARN_RATIO) return 'warn';
  return 'ok';
}

/** Shown at event setup so the 15GB problem surfaces before the wedding, not during. */
export function estimateEventBytes(guestCount: number): number {
  return guestCount * (
    ESTIMATE_PHOTOS_PER_GUEST * ESTIMATE_PHOTO_BYTES +
    ESTIMATE_VIDEOS_PER_GUEST * ESTIMATE_VIDEO_BYTES
  );
}

export function setupAdvice(guestCount: number, q: QuotaInfo) {
  const needed = estimateEventBytes(guestCount);
  const sufficient = q.freeBytes >= needed;
  return {
    neededBytes: needed,
    freeBytes: q.freeBytes,
    sufficient,
    shortfallBytes: sufficient ? 0 : needed - q.freeBytes,
  };
}
