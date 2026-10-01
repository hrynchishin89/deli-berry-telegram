# Telegram catalog v5 integration plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the approved Russian catalog to the existing Telegram bot and order server.

**Architecture:** Keep the current Express server, bot, manager destination and order storage. Serve the approved React catalog at the existing app URL; add a strictly authenticated v5 endpoint using the shared price rules. Commit a reproducible browser build so existing Render deployment commands remain compatible.

**Tech Stack:** Node, Express, Telegram Mini Apps, React, Vite; existing JSON/Postgres store.

**Spec:** Approved v5 catalog in `miniapp/README.md`, `miniapp/shared/catalog.mjs` and the owner's instruction to continue connecting the catalog.

## Global constraints

- Russian name: Дели Берри. Preserve v5 prices, 16 variants, 9 families, approved photos and preparation conditions.
- No social posting, channel edits, payments, secret retrieval or second bot process.
- Verify Telegram initData regardless of the older server's REQUIRE_TELEGRAM_AUTH setting.
- Server recomputes prices; success means the manager received the request, not order acceptance/payment.
- Retain existing admin routes and old data; require one running server/bot instance.

## Review focus

- Forged/expired identity and client prices must not create requests.
- Duplicate concurrent submits and retries must retain one order ID and not repeat confirmed delivery.
- Partial Telegram delivery must not become a false success; long messages must stay within Telegram limits.
- Existing bot menu/inline launches must send via authenticated HTTP, not keyboard-only sendData.
- Existing admin assets and approved product images must load from the production build.

### Task 1: Import approved catalog and connect order delivery

**Files:** `miniapp/**`, `src/catalogV5.js`, `src/catalogV5Messages.js`, `tests/catalog-v5.test.js`, `src/server.js`, `src/telegramBot.js`.

**Interfaces:** `createCatalogV5Service({store,config,notifyManagers,notifyCustomer,ready})` produces `submit(payload)` returning `{status,body}`. Request contains `initData` and the approved order payload. Reuse store methods `getOrder`, `createOrderWithCustomer`, `updateOrder`.

- [x] Import unchanged approved source/media and run its price tests.
- [x] Write and run failing auth, calculation, idempotency and delivery tests.
- [x] Implement the v5 adapter and message chunks; mount its API and static files.
- [x] Run the new suite and original syntax check; preserve and report baseline failure `Нет милкшейка с объёмами` from the legacy production test.
- [x] Commit the integration.

### Task 2: Connect the frontend and prepare release

**Files:** `miniapp/shared/submit.mjs`, `miniapp/tests/submit.test.mjs`, `miniapp/components/catalog/CatalogApp.tsx`, `miniapp/components/catalog/telegram.ts`, `miniapp/release/web/**`, `docs/catalog-v5-launch.md`, `package.json`.

**Interfaces:** `submitOrder(payload,initData,fetchImpl)` returns verified delivery receipt or a safe visible error. Uses `/api/catalog-v5/orders` from Task 1. No channel/customer messages in tests.

- [x] Write and run failing HTTP submit tests (success, non-JSON/server failure, no delivery receipt).
- [x] Replace keyboard-only sending with authenticated HTTP; clear cart only after receipt and prevent duplicate clicks.
- [x] Build and typecheck; check HTTP static assets and an unauthenticated request locally with BOT_TOKEN empty.
- [x] Write exact deployment, rollback and persistence limitations; review diff and commit.
- [ ] Push if an authorized GitHub transport is available. Otherwise preserve branch/patch and report the exact access error; request browser fallback only after the update is reviewable.

## Baseline and decisions

- Clean clone at ea93078969b411cc0389a9d249b52a6b2ce682ae, isolated feature branch `codex/telegram-catalog-v5`.
- `npm run check` passed before changes. `npm run test:production` failed before changes: `Нет милкшейка с объёмами` (legacy milkshake fixture).
- Existing live health reports bot and manager configured, JSON storage without persistence and legacy auth disabled. New endpoint always requires signed Telegram identity. No unrelated legacy security/storage migration is included.
- Git push dry run failed: `fatal: could not read Username for 'https://github.com': No such device or address`.
