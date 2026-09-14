import { NextResponse } from 'next/server';
import { mkdir, appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Local stand-in for Google's resumable upload endpoint. Speaks the same
 * protocol (Content-Range in, 308 + Range out, 200 + {id} on the final chunk)
 * so the guest upload path can be exercised in a browser with no Google
 * credentials. Development only — disabled unless STORAGE_PROVIDER=fake.
 */
const DIR = join(process.cwd(), '.data', 'uploads');

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.STORAGE_PROVIDER !== 'fake') {
    return NextResponse.json({ error: 'dev endpoint disabled' }, { status: 404 });
  }

  const { id } = await ctx.params;
  const range = req.headers.get('content-range') ?? '';
  await mkdir(DIR, { recursive: true });
  const path = join(DIR, id);
  const committed = await stat(path).then((s) => s.size).catch(() => 0);

  // "bytes * /total" is the client asking where we got to.
  if (range.startsWith('bytes */')) {
    return new NextResponse(null, { status: 308, headers: { range: `bytes=0-${committed - 1}` } });
  }

  const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
  if (!m) return NextResponse.json({ error: 'bad content-range' }, { status: 400 });
  const start = Number(m[1]);
  const total = Number(m[3]);

  // Reject a chunk that would leave a hole, exactly as Drive would.
  if (start !== committed) {
    return new NextResponse(null, { status: 308, headers: { range: `bytes=0-${committed - 1}` } });
  }

  await appendFile(path, Buffer.from(await req.arrayBuffer()));
  const now = await stat(path).then((s) => s.size);

  if (now >= total) return NextResponse.json({ id }, { status: 200 });
  return new NextResponse(null, { status: 308, headers: { range: `bytes=0-${now - 1}` } });
}
