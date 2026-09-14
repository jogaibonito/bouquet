import {
  pgTable, text, timestamp, integer, bigint, boolean, uuid, index, uniqueIndex, pgEnum,
} from 'drizzle-orm/pg-core';

export const uploadKindEnum = pgEnum('upload_kind', ['photo', 'video']);
export const uploadStatusEnum = pgEnum('upload_status', ['pending', 'complete', 'failed', 'hidden', 'deleted']);
export const memberRoleEnum = pgEnum('member_role', ['owner', 'cohost', 'moderator']);
export const storageBackendEnum = pgEnum('storage_backend', ['google_drive', 'r2_overflow', 'fake']);
export const reportStatusEnum = pgEnum('report_status', ['open', 'actioned', 'dismissed']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  authProvider: text('auth_provider').notNull(),
  appleSub: text('apple_sub'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Refresh tokens are encrypted at rest (CLAUDE.md gotchas). Scope is always drive.file. */
export const driveGrants = pgTable('drive_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('google_drive'),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  rootFolderId: text('root_folder_id'),
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  date: timestamp('date', { withTimezone: true }),
  coverUrl: text('cover_url'),
  theme: text('theme').notNull().default('bouquet'),
  status: text('status').notNull().default('draft'),
  bloomEnabled: boolean('bloom_enabled').notNull().default(false),
  bloomCount: integer('bloom_count').notNull().default(3),
  bloomWindowSeconds: integer('bloom_window_seconds').notNull().default(3600),
  bloomGraceCount: integer('bloom_grace_count').notNull().default(5),
  storageBackend: storageBackendEnum('storage_backend').notNull().default('google_drive'),
  storageFolderId: text('storage_folder_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const eventMembers = pgTable('event_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRoleEnum('role').notNull().default('cohost'),
}, (t) => ({ uniq: uniqueIndex('event_members_event_user').on(t.eventId, t.userId) }));

/** A guest is a signed token, never an account (invariant 2). */
export const guestSessions = pgTable('guest_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  displayName: text('display_name'),
  isBoosted: boolean('is_boosted').notNull().default(false),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  ipHash: text('ip_hash'),
  uaHash: text('ua_hash'),
}, (t) => ({ lookup: uniqueIndex('guest_sessions_event_token').on(t.eventId, t.tokenHash) }));

export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  guestSessionId: uuid('guest_session_id').notNull().references(() => guestSessions.id, { onDelete: 'cascade' }),
  providerFileId: text('provider_file_id'),
  storageBackend: storageBackendEnum('storage_backend').notNull().default('google_drive'),
  kind: uploadKindEnum('kind').notNull(),
  filename: text('filename').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  thumbKey: text('thumb_key'),
  previewKey: text('preview_key'),
  status: uploadStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  byEvent: index('uploads_event_created').on(t.eventId, t.createdAt.desc()),
  byGuest: index('uploads_guest_created').on(t.guestSessionId, t.createdAt.desc()),
}));

export const guestbook = pgTable('guestbook', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  guestSessionId: uuid('guest_session_id').notNull().references(() => guestSessions.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  uploadId: uuid('upload_id').references(() => uploads.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Store approval blocker. Do not remove (CLAUDE.md). */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  uploadId: uuid('upload_id').notNull().references(() => uploads.id, { onDelete: 'cascade' }),
  reporterSessionId: uuid('reporter_session_id').references(() => guestSessions.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  detail: text('detail'),
  status: reportStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  tier: text('tier').notNull(),
  amountCents: integer('amount_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
