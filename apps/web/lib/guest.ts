import { eq, and } from 'drizzle-orm';
import { issueGuestToken, verifyGuestToken, softFingerprint } from '@bouquet/core';
import { events, guestSessions } from '@bouquet/db/schema';
import { server, GUEST_COOKIE } from './server';

/**
 * Invariant 2. Resolves or silently creates a guest identity from a signed
 * cookie. A guest never sees a login, and never blocks on the soft fingerprint.
 */
export async function resolveGuest(req: Request, eventSlug: string) {
  const { db } = server().db;
  const secret = process.env.GUEST_TOKEN_SECRET;
  if (!secret) throw new Error('missing GUEST_TOKEN_SECRET');

  const [event] = await db.select().from(events).where(eq(events.slug, eventSlug)).limit(1);
  if (!event) throw new Error('event_not_found');

  const cookie = req.headers.get('cookie') ?? '';
  const existing = /bq_guest=([^;]+)/.exec(cookie)?.[1];

  if (existing) {
    const verified = verifyGuestToken(decodeURIComponent(existing), event.id, secret);
    if (verified) {
      const [row] = await db.select().from(guestSessions)
        .where(and(eq(guestSessions.eventId, event.id), eq(guestSessions.tokenHash, verified.tokenHash))).limit(1);
      if (row) {
        await db.update(guestSessions).set({ lastSeenAt: new Date() }).where(eq(guestSessions.id, row.id));
        return { guestSessionId: row.id, setCookie: null as string | null };
      }
    }
  }

  const issued = issueGuestToken(event.id, secret);
  const fp = softFingerprint(
    req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    req.headers.get('user-agent') ?? 'unknown',
  );
  const [created] = await db.insert(guestSessions)
    .values({ eventId: event.id, tokenHash: issued.tokenHash, ipHash: fp.ipHash, uaHash: fp.uaHash })
    .returning();
  if (!created) throw new Error('failed to create guest session');

  const setCookie = `${GUEST_COOKIE}=${encodeURIComponent(issued.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`;
  return { guestSessionId: created.id, setCookie };
}
