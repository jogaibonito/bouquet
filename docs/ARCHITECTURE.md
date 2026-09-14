# Architecture notes

## Upload path

1. Guest selects files. Client sends filename/size/mime to `POST /api/uploads/mint`.
2. Server resolves the guest (signed cookie, created silently if absent),
   loads event Bloom settings, and calls `BloomLimiter.reserve` with one
   pre-generated upload id per file.
3. For each granted id: insert a `pending` upload row, ask the storage provider
   for a resumable session URL, return that URL to the client.
4. Client PUTs 256KB chunks directly to the provider, honouring `308 Resume
   Incomplete` and the server's `Range` header rather than its own cursor.
5. On the final chunk the provider returns the file id; client calls
   `POST /api/uploads/complete` with the id and derived asset keys.
6. On give-up, client calls `POST /api/uploads/fail`, which releases the Bloom slot.

## Why reserve at step 2, not step 6

Counting on completion lets a guest open twenty parallel uploads that all observe
the same pre-increment count. `scripts/` includes a demonstration: the naive
read-then-write version grants 20 where the limit is 3. Reservation must be
atomic and must happen before any long-running work.

## Why two Redis keys

`bloom:w:{event:guest}` is the rolling window (sorted set, scored by ms).
`bloom:l:{event:guest}` is a lifetime counter used only for the grace allowance.
Grace uploads increment the lifetime counter but never enter the window — "the
first N bypass Bloom entirely" is implemented literally. Both keys share a hash
tag so they occupy one slot under Redis Cluster.

## Why the gallery never reads Drive

Rendering a 300-photo gallery from the Drive API exhausts per-user quota quickly
and is slow. Thumbnails and previews are generated client-side at upload time and
stored in R2. Drive is touched only for full-resolution download and final export.

## Quota failover

`pickProvider()` checks host Drive usage before minting. Above 95% it routes to
the R2 overflow bucket. A failed quota lookup returns the primary rather than
erroring — an upload must never fail a guest because a quota API was down.
