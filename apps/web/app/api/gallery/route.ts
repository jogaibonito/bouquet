import { NextResponse } from 'next/server';
import { server } from '@/lib/server';

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try {
    const items = await server().service.listGallery(slug, 60);
    return NextResponse.json({
      items: items.map((i) => ({ id: i.id, thumbKey: i.thumbKey ?? '' })),
    });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
