# Bouquet

Event photo sharing. Guests scan a QR code, land on a web page, and upload
full-resolution photos and video with **no app install and no account**. Files go
straight into the host's own Google Drive. Hosts manage events from a native app.

- `CLAUDE.md` — rules for writing code here. Read before touching the upload path.
- `PLAN.md` — product scope, roadmap, store compliance, risks.

## Quick start

```bash
pnpm install
cp .env.example .env          # fill GUEST_TOKEN_SECRET: openssl rand -hex 32

docker compose up -d          # Postgres 16 + Redis 7
# no Docker? use the fallback:  pnpm services:up

pnpm db:migrate
pnpm db:seed                  # demo event, Bloom set to 3/hour with 5 grace
pnpm dev                      # http://localhost:3000/e/sam-and-alex
```

`STORAGE_PROVIDER=fake` (the default) runs the entire upload path against an
in-memory Drive double, so the app is fully usable without Google credentials.
Set `STORAGE_PROVIDER=google_drive` once OAuth is configured.

## Verifying

```bash
pnpm test        # 51 tests: Bloom, guest tokens, upload service, resumable uploader
pnpm smoke       # end-to-end guest journey against real Postgres + Redis
pnpm typecheck   # strict, project references
pnpm lint        # enforces the CLAUDE.md conventions (no any, no non-null assertions)
```

## What is built

| Area | State |
|---|---|
| Bloom limiter (atomic reserve/release, rolling window, grace, boost) | Implemented, tested under concurrency |
| Guest session tokens (HMAC, cookie + localStorage, soft fingerprint) | Implemented, tested |
| Upload service (reserve-on-mint, release-on-failure, quota failover) | Implemented, tested against Postgres |
| Resumable chunked uploader (resume, backoff, silent-commit detection) | Implemented, tested against simulated drops |
| Storage providers (Drive, R2 overflow, fake double) | Drive client written, unverified against live API |
| Guest web (landing, upload panel, gallery, slideshow) | Implemented, not yet run in a browser |
| Host app (Expo) | Scaffold with auth screen and API client |
| Thumbnail generation, host dashboard, payments, push | Not started |

## The one thing to validate next

PLAN.md gates the project on resumable upload surviving real iOS Safari:
screen lock, wifi-to-cellular handoff, and mid-chunk disconnection. The uploader
handles all three against a simulated endpoint, but a simulation is not an
iPhone. Run it on a physical device before building anything on top.

## Architecture in one line

The API mints a short-lived resumable Drive session; the browser PUTs chunks
directly to Google; we store only an id and a thumbnail. Media bytes never
transit our server, and that constraint drives most of the design.
