'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile, type UploadTarget } from '@bouquet/core';
import type { MintSessionResponse } from '@bouquet/shared';

interface Props {
  slug: string;
  bloom: { enabled: boolean; count: number; windowSeconds: number };
}

interface Row { name: string; sent: number; total: number; done: boolean; failed: boolean }

const kindOf = (f: File) => (f.type.startsWith('video/') ? 'video' as const : 'photo' as const);

export default function UploadPanel({ slug, bloom }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [queued, setQueued] = useState<File[]>([]);
  const [quota, setQuota] = useState<MintSessionResponse['quota'] | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bloom rule: remaining allowance is shown BEFORE the picker opens, never
  // after the guest has already chosen fifteen photos.
  useEffect(() => {
    if (!bloom.enabled) return;
    fetch(`/api/guest/session?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json()).then((d) => setQuota(d.quota)).catch(() => {});
  }, [slug, bloom.enabled]);

  useEffect(() => {
    if (!quota?.resetAt) { setCountdown(null); return; }
    const tick = () => {
      const resetAt = quota?.resetAt;
      if (!resetAt) { setCountdown(null); return; }
      const ms = new Date(resetAt).getTime() - Date.now();
      if (ms <= 0) { setCountdown(null); setQuota((q) => q && { ...q, remaining: q.limit, resetAt: null }); return; }
      const m = Math.floor(ms / 60000);
      setCountdown(m >= 1 ? `${m} min` : `${Math.ceil(ms / 1000)} sec`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quota?.resetAt, quota?.limit]);

  const send = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/uploads/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventSlug: slug,
          files: files.map((f) => ({ filename: f.name, bytes: f.size, mimeType: f.type || 'application/octet-stream', kind: kindOf(f) })),
        }),
      });
      const data = (await res.json()) as MintSessionResponse;
      setQuota(data.quota);

      // Never reject a selection: what Bloom defers is queued, not discarded.
      // mintSessions grants a prefix of the submitted list, so index i of
      // `granted` corresponds to files[i].
      const pairs = data.granted
        .map((target, i) => ({ target, file: files[i] }))
        .filter((p): p is { target: UploadTarget; file: File } => p.file !== undefined);

      const grantedFiles = new Set(pairs.map((p) => p.file));
      setQueued((q) => [...q, ...files.filter((f) => !grantedFiles.has(f))]);
      setRows((r) => [...r, ...pairs.map(({ file }) => ({
        name: file.name, sent: 0, total: file.size, done: false, failed: false,
      }))]);

      await Promise.all(pairs.map(async ({ target, file: f }) => {
        try {
          const out = await uploadFile(f, target, {
            onProgress: (sent) => setRows((rs) => rs.map((r) => r.name === f.name ? { ...r, sent } : r)),
          });
          await fetch('/api/uploads/complete', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              uploadId: target.uploadId, providerFileId: out.providerFileId,
              width: null, height: null, durationMs: null,
              thumbKey: `th/${target.uploadId}.jpg`, previewKey: null,
            }),
          });
          setRows((rs) => rs.map((r) => r.name === f.name ? { ...r, done: true } : r));
        } catch {
          // Hand the Bloom slot back so the guest is not silently charged.
          await fetch('/api/uploads/fail', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uploadId: target.uploadId }),
          });
          setRows((rs) => rs.map((r) => r.name === f.name ? { ...r, failed: true } : r));
        }
      }));
    } finally {
      setBusy(false);
    }
  }, [slug]);

  return (
    <>
      {bloom.enabled && quota && (
        <div className="quota">
          <span>{quota.remaining > 0
            ? `You can share ${quota.remaining} more right now`
            : 'Your next photos unlock soon'}</span>
          {countdown && <strong>{countdown}</strong>}
        </div>
      )}

      <input
        ref={input} type="file" accept="image/*,video/*" multiple hidden
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void send(f); }}
      />
      <button className="cta" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Sharing…' : 'Share photos'}
      </button>

      {queued.length > 0 && (
        <p className="queued">
          {queued.length} saved for later — we&apos;ll share {countdown ? `in ${countdown}` : 'shortly'}.
        </p>
      )}

      {rows.map((r) => (
        <div className="row" key={r.name}>
          <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <div className="bar"><span style={{ width: `${Math.round((r.sent / r.total) * 100)}%` }} /></div>
          <span>{r.failed ? 'retry' : r.done ? '✓' : `${Math.round((r.sent / r.total) * 100)}%`}</span>
        </div>
      ))}

      <p className="note">
        Photos go straight to the couple&apos;s own private storage at full resolution.
        Keep this page open while sharing.
      </p>
    </>
  );
}
