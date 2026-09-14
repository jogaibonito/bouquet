import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@bouquet/db';
import { events, guestSessions, uploads } from '@bouquet/db/schema';
import { UPLOAD_CHUNK_BYTES } from '@bouquet/shared';
import type { MintSessionRequest, MintSessionResponse } from '@bouquet/shared';
import type { BloomLimiter, BloomSettings } from '../bloom/limiter.js';
import type { StorageProvider } from '../storage/provider.js';
import { quotaState } from '../storage/quota.js';

export interface UploadServiceDeps {
  db: Database;
  bloom: BloomLimiter;
  /** Primary is the host's Drive; overflow is our R2 bucket (quota failover). */
  primary: StorageProvider;
  overflow?: StorageProvider;
  now?: () => Date;
}

export class EventNotFoundError extends Error {}
export class GuestSessionNotFoundError extends Error {}

export class UploadService {
  private readonly now: () => Date;
  constructor(private readonly deps: UploadServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async mintSessions(
    req: MintSessionRequest,
    guestSessionId: string,
  ): Promise<MintSessionResponse> {
    const { db, bloom } = this.deps;

    const [event] = await db.select().from(events).where(eq(events.slug, req.eventSlug)).limit(1);
    if (!event) throw new EventNotFoundError(req.eventSlug);

    const [guest] = await db.select().from(guestSessions)
      .where(and(eq(guestSessions.id, guestSessionId), eq(guestSessions.eventId, event.id))).limit(1);
    if (!guest) throw new GuestSessionNotFoundError(guestSessionId);

    const settings: BloomSettings = {
      enabled: event.bloomEnabled,
      count: event.bloomCount,
      windowSeconds: event.bloomWindowSeconds,
      graceCount: event.bloomGraceCount,
    };

    // One id per requested file, generated up front so the Bloom reservation and
    // the upload row refer to the same identity. Release needs this id.
    const ids = req.files.map(() => randomUUID());

    const reservation = await bloom.reserve({
      eventId: event.id,
      guestSessionId: guest.id,
      uploadIds: ids,
      settings,
      bypass: guest.isBoosted,
    });

    const granted: MintSessionResponse['granted'] = [];
    const deferred: MintSessionResponse['deferred'] = [];

    const grantedSet = new Set(reservation.grantedIds);
    const provider = await this.pickProvider();

    for (const [i, file] of req.files.entries()) {
      const uploadId = ids[i];
      if (uploadId === undefined || !grantedSet.has(uploadId)) {
        deferred.push({ filename: file.filename, reason: 'bloom_limit' });
        continue;
      }

      try {
        await db.insert(uploads).values({
          id: uploadId,
          eventId: event.id,
          guestSessionId: guest.id,
          kind: file.kind,
          filename: file.filename,
          bytes: file.bytes,
          storageBackend: provider.backend,
          status: 'pending',
        });

        const session = await provider.createResumableSession({
          folderId: event.storageFolderId ?? 'root',
          filename: file.filename,
          mimeType: file.mimeType,
          bytes: file.bytes,
        });

        if (session.providerFileId) {
          await db.update(uploads).set({ providerFileId: session.providerFileId })
            .where(eq(uploads.id, uploadId));
        }

        granted.push({
          uploadId,
          sessionUrl: session.uploadUrl,
          chunkBytes: UPLOAD_CHUNK_BYTES,
          expiresAt: session.expiresAt.toISOString(),
        });
      } catch {
        // Reserve-on-mint means a failure here must hand the slot back, or the
        // guest silently loses allowance to an upload that never started.
        await bloom.release(event.id, guest.id, uploadId);
        await db.update(uploads).set({ status: 'failed' }).where(eq(uploads.id, uploadId)).catch(() => {});
        deferred.push({ filename: file.filename, reason: 'bloom_limit' });
      }
    }

    return {
      granted,
      deferred,
      quota: {
        limited: reservation.limited,
        remaining: reservation.limited ? reservation.remaining : 0,
        limit: reservation.limit,
        resetAt: reservation.resetAt?.toISOString() ?? null,
      },
    };
  }

  async completeUpload(input: {
    uploadId: string; providerFileId: string;
    width: number | null; height: number | null; durationMs: number | null;
    thumbKey: string; previewKey: string | null;
  }): Promise<void> {
    await this.deps.db.update(uploads).set({
      status: 'complete',
      providerFileId: input.providerFileId,
      width: input.width, height: input.height, durationMs: input.durationMs,
      thumbKey: input.thumbKey, previewKey: input.previewKey,
      completedAt: this.now(),
    }).where(eq(uploads.id, input.uploadId));
  }

  /** Client reports a give-up. Slot returns to the guest immediately. */
  async failUpload(uploadId: string): Promise<void> {
    const { db, bloom } = this.deps;
    const [row] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
    if (!row || row.status !== 'pending') return;
    await db.update(uploads).set({ status: 'failed' }).where(eq(uploads.id, uploadId));
    await bloom.release(row.eventId, row.guestSessionId, uploadId);
  }

  /** Gallery reads never touch Drive — only our own derived assets (CLAUDE.md). */
  async listGallery(eventSlug: string, limit = 60) {
    const { db } = this.deps;
    const [event] = await db.select().from(events).where(eq(events.slug, eventSlug)).limit(1);
    if (!event) throw new EventNotFoundError(eventSlug);
    return db.select({
      id: uploads.id, kind: uploads.kind, thumbKey: uploads.thumbKey,
      previewKey: uploads.previewKey, createdAt: uploads.createdAt,
    }).from(uploads)
      .where(and(eq(uploads.eventId, event.id), eq(uploads.status, 'complete')))
      .orderBy(desc(uploads.createdAt)).limit(limit);
  }

  private async pickProvider(): Promise<StorageProvider> {
    const { primary, overflow } = this.deps;
    if (!overflow) return primary;
    try {
      const state = quotaState(await primary.getQuota());
      return state === 'failover' ? overflow : primary;
    } catch {
      // A quota lookup failure must never fail a guest upload.
      return primary;
    }
  }
}
