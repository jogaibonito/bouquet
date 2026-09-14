import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { events } from '@bouquet/db/schema';
import { BloomLimiter } from '@bouquet/core';
import { server } from '@/lib/server';
import { resolveGuest } from '@/lib/guest';

/** Powers the "you can share N more right now" line before the picker opens. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const { db } = server().db;
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!event) return NextResponse.json({ error: 'event_not_found' }, { status: 404 });

  const guest = await resolveGuest(req, slug);
  const bloom = new BloomLimiter(server().redis);
  const peek = await bloom.peek(event.id, guest.guestSessionId, {
    enabled: event.bloomEnabled, count: event.bloomCount,
    windowSeconds: event.bloomWindowSeconds, graceCount: event.bloomGraceCount,
  });

  const res = NextResponse.json({
    quota: {
      limited: peek.limited,
      remaining: peek.limited ? peek.remaining : 0,
      limit: peek.limit,
      resetAt: peek.resetAt?.toISOString() ?? null,
    },
  });
  if (guest.setCookie) res.headers.append('set-cookie', guest.setCookie);
  return res;
}
