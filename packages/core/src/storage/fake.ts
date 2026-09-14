import { randomUUID } from 'node:crypto';
import { type StorageProvider, type ResumableSession, type QuotaInfo, makeQuota } from './provider.js';
import { UPLOAD_SESSION_TTL_SECONDS } from '@bouquet/shared';

/**
 * In-memory Drive double. Used by tests and by offline dev (STORAGE_PROVIDER=fake),
 * so the whole upload path is exercisable without Google credentials.
 */
export class FakeStorageProvider implements StorageProvider {
  readonly backend = 'fake' as const;
  readonly files = new Map<string, { folderId: string; filename: string; bytes: number }>();
  private used = 0;

  /**
   * `baseUrl` makes the minted session URL reachable from a real browser during
   * local development. Defaults to an unroutable host so server-side tests can
   * never accidentally perform network I/O.
   */
  constructor(
    private limitBytes: number | null = 15 * 1024 ** 3,
    private baseUrl = 'https://fake.upload.local/session',
  ) {}

  async createResumableSession(input: {
    folderId: string; filename: string; mimeType: string; bytes: number;
  }): Promise<ResumableSession> {
    const id = randomUUID();
    this.files.set(id, { folderId: input.folderId, filename: input.filename, bytes: input.bytes });
    this.used += input.bytes;
    return {
      uploadUrl: `${this.baseUrl}/${id}`,
      providerFileId: id,
      expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1000),
    };
  }

  async getQuota(): Promise<QuotaInfo> { return makeQuota(this.limitBytes, this.used); }

  async deleteFile(fileId: string): Promise<void> {
    const f = this.files.get(fileId);
    if (f) { this.used -= f.bytes; this.files.delete(fileId); }
  }

  /** Test helper: simulate a host whose Drive is nearly full. */
  setUsed(bytes: number) { this.used = bytes; }
}
