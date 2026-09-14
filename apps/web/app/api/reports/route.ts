import { NextResponse } from 'next/server';
import { reportRequest } from '@bouquet/shared';
import { reports, uploads } from '@bouquet/db/schema';
import { eq } from 'drizzle-orm';
import { server } from '@/lib/server';

/**
 * Store approval blocker (Apple 1.2, Play UGC). Do not remove as unused —
 * both stores require guest-facing reporting for user-generated content.
 */
export async function POST(req: Request) {
  const parsed = reportRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const { db } = server().db;
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, parsed.data.uploadId)).limit(1);
  if (!upload) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await db.insert(reports).values({
    eventId: upload.eventId,
    uploadId: upload.id,
    reason: parsed.data.reason,
    detail: parsed.data.detail ?? null,
  });
  // Hidden immediately, restorable by the host: the 24h removal requirement is
  // met without waiting for a human.
  await db.update(uploads).set({ status: 'hidden' }).where(eq(uploads.id, upload.id));
  return NextResponse.json({ ok: true });
}
