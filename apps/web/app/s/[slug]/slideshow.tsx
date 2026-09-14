'use client';
import { useEffect, useState } from 'react';

export default function Slideshow({ slug, initial }: { slug: string; initial: Array<{ id: string; thumbKey: string }> }) {
  const [items, setItems] = useState(initial);
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (items.length ? (n + 1) % items.length : 0)), 6000);
    return () => clearInterval(id);
  }, [items.length]);

  // New uploads appear within 30s without a reload.
  useEffect(() => {
    const id = setInterval(async () => {
      const r = await fetch(`/api/gallery?slug=${encodeURIComponent(slug)}`).catch(() => null);
      if (r?.ok) setItems((await r.json()).items ?? []);
    }, 20_000);
    return () => clearInterval(id);
  }, [slug]);

  const current = items[i];
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', display: 'grid', placeItems: 'center' }}>
      {current
        ? <img src={`/api/assets/${current.thumbKey}`} alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        : <p style={{ color: '#fff', fontSize: 20 }}>Waiting for the first photo…</p>}
    </div>
  );
}
