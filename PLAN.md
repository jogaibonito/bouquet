# Bouquet — Development Plan

Product decisions, scope and roadmap. Coding rules live in `CLAUDE.md`; this file explains *why* those rules exist and what we're building toward.

## Positioning

Guests share full-resolution photos and video in under ten seconds — no install, no account. The couple keeps the originals forever in their own cloud. One flat price per event, any number of guests.

Three differentiators, each aimed at a weakness in the incumbents:

| Differentiator | What it beats |
|---|---|
| No guest install | Every native-app competitor |
| Host owns the originals, no expiry | GuestPix and Kululu galleries expiring at 12 months |
| Flat per-event price | Per-guest pricing, the most resented thing in the category |

### Why native apps at all

Requiring an install would destroy the first differentiator. So: **native for hosts, web for guests.** Guests *may* install for background upload and reminders, never *must*. The host app earns its place with push notifications, background upload of the couple's own camera roll, offline moderation, and a live upload-count widget — plus store presence, which is a real acquisition channel since people search "wedding photo app."

### Out of scope

Guest accounts, social features, photo editing, print fulfilment, and anything resembling a wedding planning suite (RSVP, seating, registry).

## Scope by release

**v0.1 — Validation spike (weeks 1–2).** Resumable chunked upload from iOS Safari to Drive, proven under screen lock, network handoff and mid-chunk disconnection. Client-side thumbnailing. **The project is gated on this** — if it fails, the guest-web thesis needs rethinking before anything else is built.

**v1.0 — Launch.**
- *Host app*: auth, Drive connect, event creation, storage quota check, QR + short link, printable table cards (PDF, 4 designs), live dashboard, moderation, Bloom config, boost list, co-host invite, post-event export.
- *Guest web*: landing, camera-roll multi-select, chunked resumable upload with retry, live gallery, guestbook (photo + message, or 30s video), Bloom UI, report button, A2HS prompt.
- *Screen view*: auto-advancing slideshow, new uploads within 30s, moderated items excluded, QR in corner.

**v1.1 — 6–8 weeks post-launch.** Photo prompts and challenges ("photograph someone you've never met") — the single biggest driver of upload volume, and volume is the product. Plus service-worker offline queue, iCloud Drive as a second backend, guest push, and **Pressed**, the print-ready keepsake export.

**v2.** Dropbox/OneDrive, face grouping, auto highlight reel, multi-day events, vendor tier for planners and venues, web host console.

## Architecture

```
Guest browser ─┐
Host app ──────┼─► API ─► Postgres (events, index, guestbook)
               │     │    Redis    (Bloom counters, sessions)
               │     │    R2       (thumbnails, previews, overflow)
               │     └─► mints short-lived resumable session URL
               │              │
Guest browser ─── chunked PUT ┴─► Host's Google Drive (originals)
```

Media bytes bypassing our infrastructure is the decision everything else follows from. Consequences: near-zero bandwidth cost at any event size, originals never re-encoded, a first-dance traffic spike costs nothing, and we are not storing the photos for liability purposes. The trade-off is that we cannot scan content server-side — moderation is host-driven plus guest reporting.

## Data model

```sql
users          id, email, auth_provider, apple_sub, created_at
drive_grants   id, user_id, provider, refresh_token_enc, root_folder_id, scope, expires_at
events         id, owner_id, slug, title, date, cover_url, theme, status,
               bloom_enabled, bloom_count, bloom_window_seconds, bloom_grace_count,
               storage_backend, storage_folder_id, created_at
event_members  id, event_id, user_id, role (owner|cohost|moderator)
guest_sessions id, event_id, token_hash, display_name, is_boosted,
               first_seen_at, last_seen_at, ip_hash, ua_hash
uploads        id, event_id, guest_session_id, provider_file_id, kind (photo|video),
               filename, bytes, width, height, duration_ms, thumb_key, preview_key,
               status (pending|complete|failed|hidden|deleted), created_at, completed_at
guestbook      id, event_id, guest_session_id, message, upload_id, created_at
reports        id, event_id, upload_id, reporter_session_id, reason, status, created_at
purchases      id, event_id, user_id, source, external_id, tier, amount_cents, created_at
```

Indexes that will matter: `uploads(event_id, created_at DESC)`, `uploads(guest_session_id, created_at DESC)`, `guest_sessions(event_id, token_hash)`.

## Bloom — product design

*Enforcement mechanics are specified in `CLAUDE.md`. This is the product side.*

Photos open gradually across the evening instead of arriving in one dump. Sold to the host on three benefits: the slideshow stays fresh all night, nobody empties 200 burst shots at once, and Drive storage lasts.

The real value is the return loop. A guest who hits their limit gets a countdown and a notification when the next slot opens, which pulls them back repeatedly through the night. A throttle that only restricted would be a worse product.

**Host config.** Presets rather than raw numbers: *Relaxed* (10/hr), *Balanced* (5/hr), *Trickle* (3/hr), Custom. Plus grace allowance (default 5), active period, boost list (photographer and wedding party), and a live boost button that suspends limits for 15/30/60 minutes.

**Guest UX.** The failure to avoid: select fifteen photos, wait through a progress bar, get told you may upload three.

1. Remaining quota is visible *before* the picker opens.
2. Over-selection is never rejected — "sharing 3 now, 12 saved for 9:40pm", overflow queued locally.
3. Queue auto-flushes on rollover.
4. A live countdown, not a wall.
5. Push notification when the slot reopens.
6. Grace allowance means a guest's first interaction is never a rejection.
7. One dismissible line of explanation, never repeated.

When Bloom is on, the slideshow weights recent uploads heavily — a fresh screen is the point of throttling.

## Storage quota

A free Google account has 15GB shared across Gmail, Drive and Photos, and most are largely full. 120 guests shooting 4K will exhaust it before the first dance, silently, mid-reception. Four layers:

1. **At setup** — read quota, estimate need (`guests × 15 photos × 4MB + guests × 2 videos × 80MB`), warn on shortfall.
2. **Recommend** a Google One upgrade with a direct link, or a different backend.
3. **During the event** — poll every few minutes; warn the host at 85%, fail over at 95%.
4. **Failover** — overflow to R2, one-tap migration into Drive post-event.

None of the Drive-based competitors handle this. Doing it well is a genuine differentiator, not a chore.

Our own storage stays cheap: ~200KB per upload for thumbnail plus preview, so a 500-upload event is ~100MB. The overflow buffer is the only real cost — cap it per event and make it a paid-tier benefit.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Mobile | Expo (EAS Build) | One codebase, shares types with web, OTA updates |
| Guest web | Next.js on Vercel, PWA | Cold start matters — guests arrive from a QR with no patience |
| API | Next.js route handlers | Colocated until it hurts |
| DB | Postgres (Neon/Supabase) + Drizzle | |
| Counters | Redis (Upstash) | Bloom windows must be atomic and fast |
| Objects | Cloudflare R2 | No egress fees, and we serve thumbnails to 150 phones |
| Auth | Clerk or Auth.js | Must support Sign in with Apple |
| Payments | Stripe + RevenueCat | RevenueCat normalises Apple and Google billing |
| Ops | Sentry, PostHog, GitHub Actions | |

Flutter is a defensible alternative if you already know Dart, but loses code sharing with the guest web app — which is where most of the complexity lives.

## Timeline

One experienced full-stack developer working steadily.

| Phase | Weeks | Deliverable |
|---|---|---|
| 0. Validation | 1–2 | iOS Safari resumable upload, proven. **Gate.** |
| 1. Foundations | 3–5 | Repo, CI, schema, auth, Drive OAuth, event CRUD |
| 2. Guest web | 6–9 | Upload with retry, thumbnail pipeline, gallery, guestbook |
| 3. Host app | 10–13 | Expo shell, setup, QR, dashboard, moderation |
| 4. Bloom | 14–15 | Redis limiter, host config, countdown, local queue, boosts |
| 5. Screen view | 16 | Slideshow, realtime, recency weighting |
| 6. Payments + store prep | 17–19 | Stripe, RevenueCat, privacy labels, listings, UGC tooling |
| 7. Real-wedding pilot | 20–22 | 2–3 live events, free |
| 8. Fix and submit | 23–25 | Act on findings, submit, expect one rejection round |

**~6 months.** Three would ignore store review, the pilot, and the two weeks Drive quota edge cases will eat.

## Store compliance

**Apple**
- *4.8* — offering Google Sign-In requires offering Sign in with Apple. Keeping Drive connect as a separate, later "connect your storage" step makes Drive a data integration rather than a login method, which sidesteps this cleanly.
- *4.2* — a web view wrapper is rejected. The host app needs real native depth, visible in the reviewer demo account.
- *1.2 (UGC)* — mandatory and frequently missed: content filtering, user flagging, developer removal within 24h, a published contact method, and an EULA accepted before uploading.
- *IAP* — an in-app event unlock must use IAP (30%, or 15% under the Small Business Program). Rules on external payment links have shifted repeatedly and vary by jurisdiction — **verify the current guidelines before designing the purchase flow.** Safe default: sell on web, deliver an activation code, offer IAP in-app as convenience.
- Privacy nutrition labels and specific permission strings. "We need photo access" is rejected.

**Google**
- Data safety form, and the equivalent UGC reporting/moderation requirement.
- OAuth consent screen verification for Drive scopes. `drive.file` is Google's recommended scope and generally avoids the restricted-scope security assessment, but **confirm current classification in the Cloud console** — the difference between a form and a paid third-party audit is worth checking directly. Unverified apps cap at 100 users, so **start verification by month three.**
- Rolling target API level minimum; confirm before each submission.

**Both** — a demo account with a populated sample event and a screen recording of the QR-to-upload flow. Reviewers who can't reach a physical QR code reject for untestable core functionality.

## Pricing

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | 1 event, 50 uploads, gallery, QR |
| Event | $19 one-time | Unlimited uploads and guests, guestbook, slideshow, Bloom, printable cards, no expiry |
| Event Plus | $39 one-time | + custom branding, overflow buffer, highlight reel, priority support |

Flat per event, never per guest. The free tier's job is a full-flow test at the rehearsal dinner — 50 uploads is enough for that and not enough for the wedding.

## Testing

Beyond normal coverage:

- **Devices** — iOS Safari 16/17/18, Android Chrome, Samsung Internet, and in-app browsers. iOS Safari is where uploads break.
- **Adverse network** — 2G throttle, mid-chunk disconnect, wifi↔cellular switch, five-minute screen lock, browser kill. Each must *resume*, not restart.
- **Load** — 150 concurrent guests in a ten-minute window. This is the first-dance spike.
- **Bloom** — concurrent uploads, clock skew, rollover during an in-flight upload, boost applied mid-window.
- **Pilot at real weddings.** Two or three, free, and be physically present at one. You'll learn what no test suite surfaces: the QR cards are on the tables and nobody noticed, the DJ needs to announce it, older guests photograph the code instead of scanning it. Three weeks, findings treated as blocking.

## Legal

We process photographs of identifiable people. The host is controller, we are processor — terms must say so, with a DPA available. Also needed before submission: published terms and privacy policy, a stated retention period for our index and thumbnails, working "delete my event and all data", per-guest deletion of own uploads, and suggested consent wording for the host's table cards. Weddings have children present, so terms should place consent responsibility on the host and the age rating should reflect UGC.

Not legal advice — have a lawyer review the terms and DPA before taking money.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| iOS Safari background upload unreliable | **Critical** | Week-2 gate. Fallback: foreground-only with explicit "keep this screen open". |
| Host Drive fills mid-event | High | Quota checks, warnings, silent R2 failover |
| Venue wifi can't carry 150 uploads | High | Small chunks, offline queue, backoff, honest host guidance |
| OAuth verification delay | High | Start month three; 100-user cap until cleared |
| Rejection under 4.2 or 1.2 | Medium | Native depth and full UGC tooling before first submission |
| Nobody scans the QR | Medium | A real-world failure, not a software one: better table cards, DJ script, permanent QR on the slideshow |

## Naming

**Bouquet** — spelled identically in English, French, Spanish, German, Italian and Dutch. The metaphor extends: an event is a bouquet, uploading adds a stem, **Bloom** is the drip feature, **Pressed** is the keepsake export.

Open items: INPI and EUIPO search in **classes 9 and 42** (the term is crowded in French telecom and floristry, so a composite mark may be easier than a bare word mark); phonetic domains bought and redirected, since an anglophone hearing "boo-KAY" won't spell it; and a decision on whether wedding-locked branding is acceptable given corporate events would need a second brand.

## First three actions

1. Build the week-2 spike. Everything depends on it.
2. Register the Google Cloud project and start OAuth verification — it's the long pole.
3. Book a real wedding to pilot at. A fixed date does more for scope discipline than any roadmap.
