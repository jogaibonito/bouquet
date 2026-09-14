CREATE TYPE upload_kind AS ENUM ('photo','video');
CREATE TYPE upload_status AS ENUM ('pending','complete','failed','hidden','deleted');
CREATE TYPE member_role AS ENUM ('owner','cohost','moderator');
CREATE TYPE storage_backend AS ENUM ('google_drive','r2_overflow','fake');
CREATE TYPE report_status AS ENUM ('open','actioned','dismissed');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  auth_provider text NOT NULL,
  apple_sub text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drive_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_drive',
  refresh_token_enc text NOT NULL,
  root_folder_id text,
  scope text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  date timestamptz,
  cover_url text,
  theme text NOT NULL DEFAULT 'bouquet',
  status text NOT NULL DEFAULT 'draft',
  bloom_enabled boolean NOT NULL DEFAULT false,
  bloom_count integer NOT NULL DEFAULT 3,
  bloom_window_seconds integer NOT NULL DEFAULT 3600,
  bloom_grace_count integer NOT NULL DEFAULT 5,
  storage_backend storage_backend NOT NULL DEFAULT 'google_drive',
  storage_folder_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'cohost'
);
CREATE UNIQUE INDEX event_members_event_user ON event_members(event_id, user_id);

CREATE TABLE guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  display_name text,
  is_boosted boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  ua_hash text
);
CREATE UNIQUE INDEX guest_sessions_event_token ON guest_sessions(event_id, token_hash);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_session_id uuid NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  provider_file_id text,
  storage_backend storage_backend NOT NULL DEFAULT 'google_drive',
  kind upload_kind NOT NULL,
  filename text NOT NULL,
  bytes bigint NOT NULL,
  width integer,
  height integer,
  duration_ms integer,
  thumb_key text,
  preview_key text,
  status upload_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX uploads_event_created ON uploads(event_id, created_at DESC);
CREATE INDEX uploads_guest_created ON uploads(guest_session_id, created_at DESC);

CREATE TABLE guestbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_session_id uuid NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  message text NOT NULL,
  upload_id uuid REFERENCES uploads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  reporter_session_id uuid REFERENCES guest_sessions(id) ON DELETE SET NULL,
  reason text NOT NULL,
  detail text,
  status report_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  tier text NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
