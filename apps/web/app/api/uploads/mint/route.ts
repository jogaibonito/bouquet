import { NextResponse } from 'next/server';
import { mintSessionRequest } from '@bouquet/shared';
import { EventNotFoundError, GuestSessionNotFoundError } from '@bouquet/core';
import { server } from '@/lib/server';
import { resolveGuest } from '@/lib/guest';

/** Thin wrapper. All decisions live in UploadService so they stay testable. */
export async function POST(req: Request) {
  const parsed = mintSessionRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', detail: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const guest = await resolveGuest(req, parsed.data.eventSlug);
    const result = await server().service.mintSessions(parsed.data, guest.guestSessionId);
    const res = NextResponse.json(result);
    if (guest.setCookie) res.headers.append('set-cookie', guest.setCookie);
    return res;
  } catch (err) {
    if (err instanceof EventNotFoundError) return NextResponse.json({ error: 'event_not_found' }, { status: 404 });
    if (err instanceof GuestSessionNotFoundError) return NextResponse.json({ error: 'guest_not_found' }, { status: 401 });
    console.error('mint failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
