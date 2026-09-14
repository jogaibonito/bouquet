/** Seeds a demo event so a fresh clone has something to open. */
import { createDb } from '@bouquet/db';
import { users, events, guestSessions } from '@bouquet/db/schema';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

const { db, client } = createDb(url);

const [user] = await db.insert(users)
  .values({ email: 'demo@bouquet.test', authProvider: 'apple' })
  .onConflictDoNothing().returning();

const owner = user ?? (await db.select().from(users).limit(1))[0]!;

const [event] = await db.insert(events).values({
  ownerId: owner.id,
  slug: 'sam-and-alex',
  title: 'Sam & Alex',
  storageFolderId: 'demo-folder',
  status: 'live',
  storageBackend: 'fake',
  bloomEnabled: true,
  bloomCount: 3,
  bloomWindowSeconds: 3600,
  bloomGraceCount: 5,
}).onConflictDoNothing().returning();

if (event) {
  await db.insert(guestSessions).values({
    eventId: event.id, tokenHash: randomUUID(), displayName: 'Photographer', isBoosted: true,
  });
}

console.log('seeded: http://localhost:3000/e/sam-and-alex  (Bloom: 3/hour, grace 5)');
await client.end({ timeout: 5 });
