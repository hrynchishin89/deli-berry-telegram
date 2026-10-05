# Work log — unified-v2

- Base: feat/cloudflare-free-d1 @ 867d5c9. Restored source archive into the existing repository; no new project. Legacy folders and runtime untouched.
- Baseline: 19/19 tests passed with native workerd and isolated D1. Sandbox invocation stalled; unrestricted local test invocation completed in 8.3 s.
- Ruling: preserve Cloudflare architecture and existing vanilla frontend rather than merge obsolete React/Render backend. Cost if wrong: a separately reviewed integration would be needed; no existing code or orders deleted.
- Ruling: C04 and old `assets/set-09.webp` show whole berries; omit them from base-price choices until decoration is identified. Use approved B04 for 9 and A06 only with its existing 1790 SKU. Cost: one optional appearance temporarily omitted, not a wrong price.
- Pre-flight: group/appearance IDs must be shared by frontend and server; legacy product/variant fields remain first-line aliases for old clients and order records. Every new order stores an immutable `items` snapshot.
- External deployment: existing wrangler has placeholder D1 UUID and disabled live gates. No Cloudflare connector is available; no real customer data has been accessed or moved.


- V2 implemented: explicit 8 groups/9 families/16 SKU, appearance snapshots, multi-line cart, server reprice/consent, immutable order lines, customer-approved revisions, per-line expiry and full operator handoff. Same SKU/different appearance remains separate.
- Payment corrections: raw ES256 webhook, semantic dedupe across renewed JWTs, stable concurrent payment identity, expired-link reconciliation, CAPTURED event required. Provider sandbox is still NOT TESTED without merchant access.
- Targeted QA: Chromium on local workerd/native D1 passed buyer → cart → synthetic order → operator proposal → buyer acceptance → operator confirmation. Viewports 360/390/430/1280 and 125% text have no horizontal overflow. Default photo y=298 at 390×844. Real Telegram container NOT TESTED.
- Local D1 export/restore rehearsal passed (2 stores, 1 synthetic order, 1 event, A06 snapshot and exact sum preserved). No real customer database read or moved.
- Cloudflare CLI returned: `You are not authenticated. Please run wrangler login.` Existing D1 config still has zero UUID. No deploy, bot switch or old checkout shutdown attempted.
