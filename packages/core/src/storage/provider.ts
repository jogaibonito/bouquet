/**
 * Invariant 1: media bytes never transit our server. A provider's only job is to
 * mint a resumable session URL the client PUTs to directly, and to report quota.
 * No method here accepts a file body — that is deliberate and load-bearing.
 */
export interface ResumableSession {
  uploadUrl: string;
  providerFileId: string | null;
  expiresAt: Date;
}

export interface QuotaInfo {
  limitBytes: number | null;
  usedBytes: number;
  get freeBytes(): number;
}

export interface StorageProvider {
  readonly backend: 'google_drive' | 'r2_overflow' | 'fake';
  createResumableSession(input: {
    folderId: string;
    filename: string;
    mimeType: string;
    bytes: number;
  }): Promise<ResumableSession>;
  getQuota(): Promise<QuotaInfo>;
  deleteFile(fileId: string): Promise<void>;
}

export function makeQuota(limitBytes: number | null, usedBytes: number): QuotaInfo {
  return {
    limitBytes,
    usedBytes,
    get freeBytes() {
      return limitBytes === null ? Number.MAX_SAFE_INTEGER : Math.max(0, limitBytes - usedBytes);
    },
  };
}
