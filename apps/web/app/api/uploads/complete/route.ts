import { NextResponse } from 'next/server';
import { completeUploadRequest } from '@bouquet/shared';
import { server } from '@/lib/server';

export async function POST(req: Request) {
  const parsed = completeUploadRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  await server().service.completeUpload(parsed.data);
  return NextResponse.json({ ok: true });
}
