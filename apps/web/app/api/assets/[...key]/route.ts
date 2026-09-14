import { NextResponse } from 'next/server';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * Derived assets (thumbnails, previews). In production these live in R2; locally
 * they land on disk so the gallery and slideshow render without cloud storage.
 * Originals never pass through here — only client-generated derivatives.
 */
const DIR = join(process.cwd(), '.data', 'assets');
const safe = (parts: string[]) => parts.join('/').replace(/\.\./g, '');

export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  try {
    const buf = await readFile(join(DIR, safe(key)));
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const path = join(DIR, safe(key));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await req.arrayBuffer()));
  return NextResponse.json({ ok: true });
}
