# Unified specification v2 — implementation plan

Authority: `docs/SPEC_v2.md` (owner, 2026-10-02). Existing repository and Cloudflare branch only. Base `867d5c9`. No production data migration, paid services or live payments.

## Task 1 — grouping and server cart contract
Files: `cloudflare/public/catalog.json`, `public/assets`, `src/domain.mjs`, `test/catalog-v2.test.mjs`.
Preserve nine families / sixteen SKU and all source images; add eight groups and explicit appearance compatibility. Restore approved v5 media by original hashes; quarantine C04 and old set-09 because whole-berry decoration is ambiguous for base price. No generated photos. Implement multi-item snapshot, server totals, schedule and expiry contracts. Legacy one-item request/order remains readable.
RED: independent matrix/compatibility/cart/expiry tests must expose old behavior. GREEN: implement and run domain tests. Commit data/domain checkpoint.

## Task 2 — buyer flow and responsive presentation
Files: `public/app.js`, `styles.css`, `index.html`, client tests.
Existing routes: category → size → type → appearance → detail → cart → checkout → order. Exact copy/tokens, persistent filter/scroll, explicit incompatible reset, validated SKU links. Server quote/version consent, durable pending request retry, no public PII form while legal gate is off. One bottom CTA, accessible states, safe area. RED→GREEN client behavior tests, then browser screenshots at 360/390/430 and desktop.

## Task 3 — durable orders, operator and Yandex Pay
Files: `src/service.mjs`, `worker.mjs`, `config.mjs`, `yandex-pay.mjs`, `telegram.mjs`, migrations, `public/operator.js`, D1 tests.
Keep existing database and API identities. Atomic unique request, immutable appearance snapshot, agreed pre-payment revision, separate payment/fulfilment, outbox and expiry. `/v1/webhook` ES256 raw body, semantic dedupe, captured-only PAID, no invented webhook secret. Testing only synthetic local D1 and mocked provider; actual sandbox separately NOT TESTED without credentials. All business mutation commands guarded by order version and current store schedule. RED→GREEN D1 tests and complete suite.

## Task 4 — release, review and evidence
Files: workflow, checks, README/rollback, acceptance report and one ZIP.
Replace archive-only deployment with tracked `cloudflare/` source; keep legacy source archive and old runtime untouched. Build reproducibly, verify migrations/backup restore, run secrets/asset checks, capture real UI screenshots without PII. One whole-branch fresh-context review; fix material findings with regression tests. Publish only if configured free Cloudflare access exists; otherwise no invented URL or bot cutover. Push same-repository branch and report commit, A1–A12, three readiness levels and concrete blockers.

## Interfaces and review focus
Catalogue appearances feed browser selection and server price validation; order `items` snapshot feeds buyer, operator, provider and expiry, with legacy single-item adapter. Check missing/forged appearance IDs, incompatible type resets, multi-item price acceptance, network loss after commit, concurrent mutations/payment creation, stale webhook status, late payment, holiday closure, mixed-batch expiry, phone/address leakage and disabled public contacts.

