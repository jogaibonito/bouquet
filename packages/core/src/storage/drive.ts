import { type StorageProvider, type ResumableSession, type QuotaInfo, makeQuota } from './provider.js';
import { UPLOAD_SESSION_TTL_SECONDS } from '@bouquet/shared';

const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true';
const ABOUT_ENDPOINT = 'https://www.googleapis.com/drive/v3/about?fields=storageQuota';

export interface DriveAuth { getAccessToken(): Promise<string>; }

/**
 * Google Drive, drive.file scope only (CLAUDE.md). We initiate the resumable
 * session server-side so the access token is never exposed, then hand the
 * session URL to the client — the session URL alone authorizes the upload.
 */
export class GoogleDriveProvider implements StorageProvider {
  readonly backend = 'google_drive' as const;
  constructor(private readonly auth: DriveAuth, private readonly fetchImpl: typeof fetch = fetch) {}

  async createResumableSession(input: {
    folderId: string; filename: string; mimeType: string; bytes: number;
  }): Promise<ResumableSession> {
    const token = await this.auth.getAccessToken();
    const res = await this.fetchImpl(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': input.mimeType,
        'X-Upload-Content-Length': String(input.bytes),
      },
      body: JSON.stringify({ name: input.filename, parents: [input.folderId] }),
    });
    if (!res.ok) {
      throw new DriveError(`resumable session failed: ${res.status}`, res.status);
    }
    const uploadUrl = res.headers.get('location');
    if (!uploadUrl) throw new DriveError('Drive returned no session Location header', 502);

    return {
      uploadUrl,
      providerFileId: null, // assigned by Drive on final chunk; client reports it back
      expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1000),
    };
  }

  async getQuota(): Promise<QuotaInfo> {
    const token = await this.auth.getAccessToken();
    const res = await this.fetchImpl(ABOUT_ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new DriveError(`quota lookup failed: ${res.status}`, res.status);
    const body = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } };
    const limit = body.storageQuota?.limit;
    return makeQuota(limit ? Number(limit) : null, Number(body.storageQuota?.usage ?? 0));
  }

  async deleteFile(fileId: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const res = await this.fetchImpl(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) throw new DriveError(`delete failed: ${res.status}`, res.status);
  }
}

export class DriveError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'DriveError'; }
}
