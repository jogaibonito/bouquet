import { server } from '@/lib/server';
import Slideshow from './slideshow';

/** Projector view. Bloom-weighted toward recent uploads — a fresh screen is the point. */
export default async function ScreenView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const initial = await server().service.listGallery(slug, 40);
  return <Slideshow slug={slug} initial={initial.map((g) => ({ id: g.id, thumbKey: g.thumbKey ?? '' }))} />;
}
