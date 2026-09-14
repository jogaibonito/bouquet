import { NextResponse } from 'next/server';
import { failUploadRequest } from '@bouquet/shared';
import { server } from '@/lib/server';

/** Returns the guest's Bloom slot. Reserve-on-mint makes this path mandatory. */
export async function POST(req: Request) {
  const parsed = failUploadRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  await server().service.failUpload(parsed.data.uploadId);
  return NextResponse.json({ ok: true });
}
