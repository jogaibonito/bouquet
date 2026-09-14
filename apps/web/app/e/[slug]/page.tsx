import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { events } from '@bouquet/db/schema';
import { server } from '@/lib/server';
import UploadPanel from './upload-panel';

/**
 * Server component by default. The guest landing page cold start is a product
 * requirement, so the client bundle here stays limited to the upload panel.
 */
export default async function GuestLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db } = server().db;
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!event) notFound();

  const gallery = await server().service.listGallery(slug, 18);

  return (
    <main>
      {event.coverUrl
        ? <img className="cover" src={event.coverUrl} alt="" />
        : <div className="cover" />}
      <h1>{event.title}</h1>
      <p className="sub">Share your photos with the couple. No app, no account.</p>

      <UploadPanel
        slug={slug}
        bloom={{
          enabled: event.bloomEnabled,
          count: event.bloomCount,
          windowSeconds: event.bloomWindowSeconds,
        }}
      />

      {gallery.length > 0 && (
        <div className="grid">
          {gallery.map((g) => (
            <img key={g.id} src={`/api/assets/${g.thumbKey}`} alt="" loading="lazy" />
          ))}
        </div>
      )}
    </main>
  );
}
