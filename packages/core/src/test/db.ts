import { createDb } from '@bouquet/db';
import { events, users, guestSessions } from '@bouquet/db/schema';
import { randomUUID } from 'node:crypto';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://bouquet:bouquet@127.0.0.1:5432/bouquet_test';

export function testDb() { return createDb(TEST_DB_URL, { max: 5 }); }

export async function seedEvent(db: ReturnType<typeof testDb>['db'], over: Partial<{
  bloomEnabled: boolean; bloomCount: number; bloomWindowSeconds: number; bloomGraceCount: number;
}> = {}) {
  const slug = `evt-${randomUUID().slice(0, 8)}`;
  const [user] = await db.insert(users)
    .values({ email: `${slug}@example.test`, authProvider: 'apple' }).returning();
  const [event] = await db.insert(events).values({
    ownerId: user!.id, slug, title: 'Test Wedding', storageFolderId: 'folder-1',
    bloomEnabled: over.bloomEnabled ?? false,
    bloomCount: over.bloomCount ?? 3,
    bloomWindowSeconds: over.bloomWindowSeconds ?? 3600,
    bloomGraceCount: over.bloomGraceCount ?? 0,
  }).returning();
  return { user: user!, event: event! };
}

export async function seedGuest(
  db: ReturnType<typeof testDb>['db'], eventId: string, over: { isBoosted?: boolean } = {},
) {
  const [guest] = await db.insert(guestSessions).values({
    eventId, tokenHash: randomUUID(), displayName: 'Guest', isBoosted: over.isBoosted ?? false,
  }).returning();
  return guest!;
}

export const file = (name: string, bytes = 4_000_000) => ({
  filename: name, bytes, mimeType: 'image/jpeg', kind: 'photo' as const,
});
