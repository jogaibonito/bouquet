import type { MintSessionResponse, BloomConfig } from '@bouquet/shared';

const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Host app API client. The mobile app manages events; it never handles guest
 * uploads, which stay on the web surface by design.
 */
export const api = {
  async dashboard(eventSlug: string, token: string) {
    return json(`/api/host/events/${eventSlug}/dashboard`, token);
  },
  async setBloom(eventSlug: string, config: BloomConfig, token: string) {
    return json(`/api/host/events/${eventSlug}/bloom`, token, { method: 'PUT', body: JSON.stringify(config) });
  },
  async moderate(uploadId: string, action: 'hide' | 'restore' | 'delete', token: string) {
    return json(`/api/host/uploads/${uploadId}`, token, { method: 'PATCH', body: JSON.stringify({ action }) });
  },
  async quota(eventSlug: string, token: string) {
    return json(`/api/host/events/${eventSlug}/quota`, token);
  },
};

async function json(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export type { MintSessionResponse };
