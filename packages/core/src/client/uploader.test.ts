import { describe, it, expect, vi } from 'vitest';
import { uploadFile, backoffMs, UploadFailedError, UploadAbortedError, type Blobish } from './uploader.js';

/** Minimal Blob stand-in so the uploader can be tested outside a browser. */
const fakeFile = (size: number): Blobish => ({
  size,
  slice: (start: number, end: number) => ({ start, end, length: end - start }),
});

/**
 * A resumable endpoint that tracks committed bytes, so a test can assert the
 * client never skips or duplicates a range.
 */
function fakeEndpoint(opts: {
  total: number;
  failAt?: number[];          // offsets whose first attempt throws (network drop)
  silentCommit?: number[];    // offsets committed server-side despite the drop
  status?: number;
} = { total: 0 }) {
  let committed = 0;
  const seen: Array<[number, number]> = [];
  const failed = new Set<number>();

  const impl = vi.fn(async (_url: string, init: RequestInit) => {
    const cr = (init.headers as Record<string, string>)['Content-Range']!;

    if (cr.startsWith('bytes */')) {
      return new Response(null, { status: 308, headers: { range: `bytes=0-${committed - 1}` } });
    }

    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr)!;
    const start = Number(m[1]);
    const end = Number(m[2]);

    if (opts.failAt?.includes(start) && !failed.has(start)) {
      failed.add(start);
      if (opts.silentCommit?.includes(start)) committed = end + 1;
      throw new TypeError('network error');
    }

    seen.push([start, end]);
    committed = end + 1;

    if (committed >= opts.total) {
      return new Response(JSON.stringify({ id: 'drive-file-1' }), { status: 200 });
    }
    return new Response(null, { status: 308, headers: { range: `bytes=0-${committed - 1}` } });
  });

  return { impl: impl as unknown as typeof fetch, seen, get committed() { return committed; } };
}

const noSleep = async () => {};

describe('uploader — happy path', () => {
  it('uploads a file in chunks and returns the provider file id', async () => {
    const total = 256 * 1024 * 3;
    const ep = fakeEndpoint({ total });
    const out = await uploadFile(fakeFile(total), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep });

    expect(out.providerFileId).toBe('drive-file-1');
    expect(out.bytesSent).toBe(total);
    expect(ep.seen).toHaveLength(3);
  });

  it('covers every byte exactly once, with no gaps or overlaps', async () => {
    const total = 256 * 1024 * 4 + 1234;
    const ep = fakeEndpoint({ total });
    await uploadFile(fakeFile(total), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep });

    let cursor = 0;
    for (const [start, end] of ep.seen) {
      expect(start).toBe(cursor);
      cursor = end + 1;
    }
    expect(cursor).toBe(total);
  });

  it('handles a file smaller than one chunk', async () => {
    const ep = fakeEndpoint({ total: 900 });
    const out = await uploadFile(fakeFile(900), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep });
    expect(out.chunksSent).toBe(1);
    expect(out.bytesSent).toBe(900);
  });

  it('reports monotonic progress', async () => {
    const total = 256 * 1024 * 3;
    const ep = fakeEndpoint({ total });
    const seen: number[] = [];
    await uploadFile(fakeFile(total), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep, onProgress: (sent) => seen.push(sent) });

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(total);
  });
});

describe('uploader — adverse network (the iOS Safari cases)', () => {
  it('resumes mid-file after a dropped connection', async () => {
    const total = 256 * 1024 * 4;
    const ep = fakeEndpoint({ total, failAt: [256 * 1024] });
    const out = await uploadFile(fakeFile(total), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep });

    expect(out.bytesSent).toBe(total);
    let cursor = 0;
    for (const [start, end] of ep.seen) { expect(start).toBe(cursor); cursor = end + 1; }
  });

  it('does not resend a chunk the server silently committed', async () => {
    // The wifi-to-cellular case: the request dies but the server kept the bytes.
    const total = 256 * 1024 * 4;
    const offset = 256 * 1024;
    const ep = fakeEndpoint({ total, failAt: [offset], silentCommit: [offset] });

    const out = await uploadFile(fakeFile(total), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep });

    expect(out.resumeCount).toBeGreaterThan(0);
    const starts = ep.seen.map(([s]) => s);
    expect(new Set(starts).size).toBe(starts.length); // no duplicate ranges
    expect(out.bytesSent).toBe(total);
  });

  it('survives repeated drops across several chunks', async () => {
    const total = 256 * 1024 * 6;
    const ep = fakeEndpoint({ total, failAt: [0, 256 * 1024 * 2, 256 * 1024 * 4] });
    const out = await uploadFile(fakeFile(total), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep });
    expect(out.bytesSent).toBe(total);
  });

  it('gives up after the attempt ceiling instead of looping forever', async () => {
    const alwaysDead = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(uploadFile(fakeFile(1024), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: alwaysDead, sleep: noSleep, maxAttemptsPerChunk: 3 }))
      .rejects.toBeInstanceOf(UploadFailedError);
  });

  it('fails fast on a permanent 4xx rather than burning retries', async () => {
    const impl = vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    await expect(uploadFile(fakeFile(1024), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: impl, sleep: noSleep })).rejects.toBeInstanceOf(UploadFailedError);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 rather than treating it as permanent', async () => {
    let calls = 0;
    const impl = (async (_u: string, init: RequestInit) => {
      const cr = (init.headers as Record<string, string>)['Content-Range']!;
      if (cr.startsWith('bytes */')) return new Response(null, { status: 308, headers: { range: 'bytes=0--1' } });
      calls++;
      if (calls < 3) return new Response(null, { status: 429 });
      return new Response(JSON.stringify({ id: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await uploadFile(fakeFile(1024), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: impl, sleep: noSleep });
    expect(out.providerFileId).toBe('ok');
  });

  it('stops promptly when the guest cancels', async () => {
    const ctrl = new AbortController();
    const ep = fakeEndpoint({ total: 256 * 1024 * 10 });
    ctrl.abort();
    await expect(uploadFile(fakeFile(256 * 1024 * 10), {
      uploadId: 'u1', sessionUrl: 'https://up.test/s/1', chunkBytes: 256 * 1024,
    }, { fetchImpl: ep.impl, sleep: noSleep, signal: ctrl.signal }))
      .rejects.toBeInstanceOf(UploadAbortedError);
  });
});

describe('backoff', () => {
  it('grows with the attempt number', () => {
    expect(backoffMs(1, () => 1)).toBeLessThan(backoffMs(4, () => 1));
  });
  it('caps so a guest is never left waiting minutes', () => {
    expect(backoffMs(20, () => 1)).toBeLessThanOrEqual(30_000);
  });
  it('jitters to avoid 150 phones retrying in lockstep', () => {
    expect(backoffMs(5, () => 0)).toBeLessThan(backoffMs(5, () => 1));
  });
});
