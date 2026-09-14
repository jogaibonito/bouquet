import type Redis from 'ioredis';
import { RESERVE_LUA, RELEASE_LUA } from './lua.js';

export interface BloomSettings {
  enabled: boolean;
  count: number;
  windowSeconds: number;
  graceCount: number;
}

export interface ReserveInput {
  eventId: string;
  guestSessionId: string;
  /** Pre-generated upload ids. One slot is reserved per id, in order. */
  uploadIds: string[];
  settings: BloomSettings;
  /** Boosted guests and live-boost windows bypass Bloom without consuming a slot. */
  bypass?: boolean;
  now?: number;
}

export interface ReserveResult {
  grantedIds: string[];
  deferredIds: string[];
  /** Slots actually written to the rolling window; only these need releasing. */
  windowMembers: string[];
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date | null;
  limited: boolean;
}

/** Same hash tag on both keys keeps them in one Redis Cluster slot. */
const tag = (eventId: string, guestSessionId: string) => `{${eventId}:${guestSessionId}}`;
const windowKey = (e: string, g: string) => `bloom:w:${tag(e, g)}`;
const lifetimeKey = (e: string, g: string) => `bloom:l:${tag(e, g)}`;

export class BloomLimiter {
  constructor(private readonly redis: Redis) {}

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const { eventId, guestSessionId, uploadIds, settings } = input;
    const now = input.now ?? Date.now();

    // Bypass paths consume nothing: an unlimited guest must not age the window
    // for anyone, and a disabled Bloom must leave no Redis footprint at all.
    if (!settings.enabled || input.bypass) {
      return {
        grantedIds: [...uploadIds],
        deferredIds: [],
        windowMembers: [],
        remaining: uploadIds.length,
        limit: settings.count,
        used: 0,
        resetAt: null,
        limited: false,
      };
    }

    const windowMs = settings.windowSeconds * 1000;
    const ttl = windowMs + 60_000;

    const raw = (await this.redis.eval(
      RESERVE_LUA,
      2,
      windowKey(eventId, guestSessionId),
      lifetimeKey(eventId, guestSessionId),
      String(now),
      String(windowMs),
      String(settings.count),
      String(uploadIds.length),
      String(settings.graceCount),
      String(ttl),
      ...uploadIds,
    )) as [number, number, number, number, number, string];

    const [granted, , remaining, used, resetAtMs, membersJson] = raw;
    const windowMembers = JSON.parse(membersJson) as string[];

    return {
      grantedIds: uploadIds.slice(0, granted),
      deferredIds: uploadIds.slice(granted),
      windowMembers,
      remaining,
      limit: settings.count,
      used,
      resetAt: resetAtMs > 0 ? new Date(resetAtMs) : null,
      limited: true,
    };
  }

  /** Called when an upload fails or is cancelled. Reserve-on-mint demands this. */
  async release(eventId: string, guestSessionId: string, uploadId: string): Promise<void> {
    await this.redis.eval(
      RELEASE_LUA,
      2,
      windowKey(eventId, guestSessionId),
      lifetimeKey(eventId, guestSessionId),
      uploadId,
    );
  }

  /** Read-only. Powers "you can share 3 more right now" before the picker opens. */
  async peek(
    eventId: string,
    guestSessionId: string,
    settings: BloomSettings,
    now = Date.now(),
  ): Promise<{ remaining: number; limit: number; used: number; resetAt: Date | null; limited: boolean }> {
    if (!settings.enabled) {
      return { remaining: Number.MAX_SAFE_INTEGER, limit: 0, used: 0, resetAt: null, limited: false };
    }
    const windowMs = settings.windowSeconds * 1000;
    const zkey = windowKey(eventId, guestSessionId);
    const lkey = lifetimeKey(eventId, guestSessionId);

    const [, , lifetimeRaw, entries] = (await this.redis
      .multi()
      .zremrangebyscore(zkey, '-inf', now - windowMs)
      .zcard(zkey)
      .get(lkey)
      .zrange(zkey, 0, 0, 'WITHSCORES')
      .exec()) as Array<[Error | null, unknown]>;

    const lifetime = Number((lifetimeRaw?.[1] as string) ?? 0);
    const oldest = entries?.[1] as string[] | undefined;
    const used = await this.redis.zcard(zkey);
    const graceRemain = Math.max(0, settings.graceCount - lifetime);
    const windowRemain = Math.max(0, settings.count - used);
    const resetAt =
      windowRemain === 0 && oldest?.[1] ? new Date(Number(oldest[1]) + windowMs) : null;

    return { remaining: graceRemain + windowRemain, limit: settings.count, used, resetAt, limited: true };
  }

  async reset(eventId: string, guestSessionId: string): Promise<void> {
    await this.redis.del(windowKey(eventId, guestSessionId), lifetimeKey(eventId, guestSessionId));
  }
}
