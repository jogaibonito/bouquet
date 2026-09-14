# CLAUDE.md

Rules for writing code in this repo. Rationale, roadmap and scope live in `PLAN.md` — read it once, not every session.

## Product

Bouquet. Guests scan a QR code at an event, land on a mobile web page, upload full-res photos/videos with **no install and no account**. Files land in the host's own Google Drive. Hosts manage events from a native app.

| Surface | Path | Notes |
|---|---|---|
| Guest web | `apps/web/app/e/[slug]` | The product's core. No install, no login. |
| Screen view | `apps/web/app/s/[slug]` | Projector slideshow. No chrome. |
| Host app | `apps/mobile` | Expo. Setup, moderation, dashboard, Bloom config. |

## Layout

```
apps/web      Next.js — guest upload, screen view, marketing, API handlers
apps/mobile   Expo — host app, iOS + Android
packages/db   Drizzle schema + migrations (Postgres). Schema is the source of truth.
packages/shared  Zod schemas, types, constants. Imported by web and mobile.
packages/config  tsconfig, eslint, prettier
```

pnpm workspaces + Turborepo. Never import across `apps/`; shared code goes in `packages/shared`.

## Commands

```bash
pnpm dev / dev:web / dev:mobile
pnpm db:generate | db:migrate | db:studio
pnpm test          # Vitest
pnpm test:e2e      # Playwright, guest upload flow
pnpm typecheck     # run before declaring any work done
pnpm lint
```

## Invariants

Load-bearing. Do not change without discussion.

1. **Media bytes never transit our server.** The API mints a short-lived resumable Drive session; the client PUTs chunks directly to Google. We store only the file ID plus a client-generated thumbnail. Proxying, buffering or streaming originals through our infra is always wrong.
2. **Guests never authenticate.** Identity is a signed opaque token in `localStorage` *and* an httpOnly cookie (iOS evicts `localStorage`). A feature that seems to need a guest account needs a different design.
3. **Guest path stays at three taps:** scan → land → upload. No tutorials, interstitials, or install prompts beyond a dismissible A2HS.
4. **The client is never trusted** for quota or permissions. The server re-checks on every session mint.
5. **Originals are never re-encoded.** The Drive file is byte-identical to what left the phone. Thumbnails and previews are separate derived files.

## Storage

- Originals → host's Drive, `drive.file` scope only.
- Thumbnails (~400px) and video previews (~720p) → R2, generated client-side. Gallery, slideshow and moderation read **only** from R2; Drive API quota won't survive rendering a 300-photo gallery.
- Host Drive full → fail over to the R2 overflow bucket silently. Warn the host, never the guest. An upload must never fail on quota.

## Bloom (per-guest upload throttle)

Optional per-event limit: N uploads per rolling window.

- **Rolling window, never fixed buckets** (buckets cause a stampede on the hour).
- Redis sorted set `bloom:{event_id}:{guest_session_id}`, scored by ms timestamp. Check-and-increment **must be one Lua script** — otherwise parallel uploads from one phone all pass.
- **Reserve the slot at session mint; release on failure or cancel.** Counting on completion lets a guest open twenty uploads at once and slip past.
- TTL = window + margin, so keys self-clean.
- Check grace allowance, boost list and live boost **before** consuming a slot.
- Never reject a selection: queue overflow client-side and surface a countdown.
- Tune for **zero false positives**. IP/UA hashes are a soft signal for host review only — never block on them.

## Gotchas

- **iOS Safari breaks uploads.** Any upload-path change must be tested against: screen lock mid-upload, wifi↔cellular handoff, backgrounded tab, dropped connection mid-chunk, and in-app browsers (Instagram, Facebook, Messages).
- Chunk at **256KB** with exponential backoff. Venue wifi is genuinely bad.
- `drive.file` scope only — broader scopes trigger heavier verification and break our privacy claim. Refresh tokens encrypted at rest in `drive_grants`.
- Prefer Expo modules over bare native; ejecting costs us OTA updates.

## Do not delete these (store approval blockers)

- Report button on every uploaded item, host-side removal, working support contact.
- Sign in with Apple wherever Google Sign-In appears. Host **auth** stays strictly separate from Drive **authorization** (Drive connect is a later, distinct step) — this is what keeps us clear of Apple 4.8.
- Permission strings that describe actual use.
- Genuine native functionality in the host app. It must not become a web view wrapper.

## Conventions

- TypeScript strict. No `any`, no non-null assertions outside tests. Prefer `unknown` and narrow.
- **Zod at every boundary** (API inputs, env, external responses). Schemas live in `packages/shared` and are the type source — derive with `z.infer`, never hand-write a parallel interface.
- Drizzle for all DB access; raw SQL only in migrations.
- Typed result objects at API boundaries, thrown exceptions internally. Never swallow an error in the upload path — Sentry with event ID and guest session ID.
- `snake_case` in the DB, `camelCase` in TS, `kebab-case` for files and routes.
- Server components by default in `apps/web`; `'use client'` only where interactivity demands it. Guest landing cold start is a product requirement — keep that bundle small.
- Comments explain *why*, never *what*.
- Any change to Bloom enforcement or session minting needs a test covering the concurrent case.

## Environment

Copy `.env.example`. Local: `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `R2_*`, `NEXT_PUBLIC_APP_URL`. Never commit secrets; production lives in Vercel and EAS.

## Ask, don't guess

- The session mint or Bloom concurrency model
- Google OAuth scopes or consent screen config
- Pricing, IAP, payment routing — store policy shifts; verify current rules
- Schema changes to `uploads`, `guest_sessions`, `drive_grants`
- Anything adding a step in front of a guest
