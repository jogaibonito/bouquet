import { UPLOAD_CHUNK_BYTES } from '@bouquet/shared';

/**
 * Resumable chunked uploader. This is the week-0 gate from PLAN.md: it must
 * survive screen lock, wifi<->cellular handoff, and mid-chunk disconnection on
 * iOS Safari. Every failure path resumes from the server's committed offset
 * rather than restarting the file.
 */
export interface UploadTarget {
  uploadId: string;
  sessionUrl: string;
  chunkBytes: number;
}

export interface Blobish {
  readonly size: number;
  slice(start: number, end: number): unknown;
}

export interface UploaderOptions {
  fetchImpl?: typeof fetch;
  maxAttemptsPerChunk?: number;
  /** Injected for tests; real callers use the default backoff. */
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

export interface UploadOutcome {
  uploadId: string;
  providerFileId: string;
  bytesSent: number;
  chunksSent: number;
  resumeCount: number;
}

export class UploadAbortedError extends Error {}
export class UploadFailedError extends Error {
  constructor(message: string, readonly lastStatus: number | null) { super(message); }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Full jitter, capped. Long enough to outlast a lift ride, short enough to feel live. */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const capped = Math.min(30_000, 500 * 2 ** attempt);
  return Math.floor(capped * (0.5 + rand() * 0.5));
}

export async function uploadFile(
  file: Blobish,
  target: UploadTarget,
  opts: UploaderOptions = {},
): Promise<UploadOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttemptsPerChunk ?? 6;
  const chunkSize = target.chunkBytes || UPLOAD_CHUNK_BYTES;

  let offset = 0;
  let chunksSent = 0;
  let resumeCount = 0;
  let lastStatus: number | null = null;

  while (offset < file.size) {
    if (opts.signal?.aborted) throw new UploadAbortedError('upload aborted');

    const end = Math.min(offset + chunkSize, file.size);
    const chunk = file.slice(offset, end);
    let attempt = 0;
    let committed = false;

    while (!committed) {
      if (opts.signal?.aborted) throw new UploadAbortedError('upload aborted');
      try {
        const res = await doFetch(target.sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
            'Content-Length': String(end - offset),
          },
          body: chunk as BodyInit,
        });
        lastStatus = res.status;

        // 200/201: final chunk committed, provider returns the file id.
        if (res.status === 200 || res.status === 201) {
          const body = (await res.json().catch(() => ({}))) as { id?: string };
          opts.onProgress?.(file.size, file.size);
          return {
            uploadId: target.uploadId,
            providerFileId: body.id ?? '',
            bytesSent: file.size,
            chunksSent: chunksSent + 1,
            resumeCount,
          };
        }

        // 308: chunk accepted, more expected. Trust the server's Range, not ours.
        if (res.status === 308) {
          const range = res.headers.get('range');
          offset = range ? Number(range.split('-')[1]) + 1 : end;
          chunksSent++;
          committed = true;
          opts.onProgress?.(offset, file.size);
          break;
        }

        // 4xx other than 408/429 is permanent — retrying cannot help.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw new UploadFailedError(`permanent upload error ${res.status}`, res.status);
        }

        throw new Error(`transient upload error ${res.status}`);
      } catch (err) {
        if (err instanceof UploadFailedError || err instanceof UploadAbortedError) throw err;
        attempt++;
        if (attempt >= maxAttempts) {
          throw new UploadFailedError(`chunk at ${offset} failed after ${attempt} attempts`, lastStatus);
        }
        await sleep(backoffMs(attempt));
        // Ask the server where it actually got to. A dropped connection may have
        // committed the chunk anyway — re-sending blind would corrupt the file.
        const resumed = await queryOffset(target.sessionUrl, file.size, doFetch);
        if (resumed !== null && resumed !== offset) {
          offset = resumed;
          resumeCount++;
          committed = true;
        }
      }
    }
  }

  throw new UploadFailedError('upload ended without a completion response', lastStatus);
}

/** Zero-length PUT with a wildcard range: the standard "where are you?" probe. */
export async function queryOffset(
  sessionUrl: string, totalBytes: number, doFetch: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const res = await doFetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${totalBytes}`, 'Content-Length': '0' },
    });
    if (res.status === 200 || res.status === 201) return totalBytes;
    if (res.status === 308) {
      const range = res.headers.get('range');
      return range ? Number(range.split('-')[1]) + 1 : 0;
    }
    return null;
  } catch {
    return null;
  }
}
