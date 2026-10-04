import { test } from "node:test";
import assert from "node:assert/strict";
import catalog from "../public/catalog.json" with { type: "json" };
import * as domain from "../src/domain.mjs";
const now = new Date("2026-10-02T06:45:01Z");
const item = (sku = "SET-12-A06", appearanceId = "A06", extra = {}) => ({
  sku,
  appearanceId,
  quantity: 1,
  addOns: [],
  ...extra,
});
const raw = (items) => ({
  items,
  expectedTotalKopecks: 204000,
  customer: { name: "Тест", phone: "+79990000000" },
  store: { id: "discovery" },
  schedule: { date: "2026-10-03", time: "10:00" },
  fulfilment: { type: "pickup" },
  consent: true,
});
test("A1: eight groups preserve all sixteen separately priced SKUs and fresh/FD counts", () => {
  assert.equal(catalog.groups?.length, 8);
  assert.equal(catalog.products.length, 9);
  const expected = {
    "SET-09": [1, 1],
    "SET-12": [2, 1],
    "SET-16": [1, 1],
    "SET-25": [1, 0],
    "MIX-BANANA": [1, 0],
    "BQT-19": [2, 1],
    "BQT-35": [1, 1],
    "BQT-39": [1, 1],
  };
  for (const g of catalog.groups) {
    const vs = catalog.products
      .filter((p) => g.families.includes(p.id))
      .flatMap((p) => p.variants);
    assert.deepEqual(
      [
        vs.filter((v) => v.type === "fresh").length,
        vs.filter((v) => v.type === "freeze_dried").length,
      ],
      expected[g.id],
    );
  }
  const prices = [
    1190, 890, 1590, 1790, 990, 1990, 1250, 2790, 1990, 2750, 4890, 3290, 2790,
    1690, 4390, 2950,
  ];
  assert.deepEqual(
    catalog.products.flatMap((p) => p.variants.map((v) => v.price)),
    prices,
  );
});
test("A2: A06 inscription is 2040; double berry and invalid SKU/appearance/addons rejected", () => {
  assert.equal(typeof domain.priceCart, "function");
  assert.equal(
    domain.priceCart(catalog, {
      items: [
        item(undefined, undefined, {
          addOns: [{ id: "chocolate-inscription" }],
          inscriptionText: "Очень длинная надпись ".repeat(4),
        }),
      ],
    }).totalKopecks,
    204000,
  );
  for (const i of [
    item(undefined, undefined, { addOns: [{ id: "whole-blueberry" }] }),
    item("SET-12-FRESH", "B02", {
      addOns: [{ id: "whole-blueberry" }, { id: "whole-blueberry" }],
    }),
    item("BQT-A07-FRESH", "A07", {
      addOns: [{ id: "chocolate-inscription" }],
      inscriptionText: "Тест",
    }),
    item("BQT-B09-FD", "A07"),
    item("SET-09-FRESH", "C04"),
  ])
    assert.throws(() => domain.priceCart(catalog, { items: [i] }));
});
test("Owner update: raspberry is not an active add-on and old requests are rejected", () => {
  assert.deepEqual(
    catalog.pricing.addOns.map((addOn) => addOn.id),
    ["whole-blueberry", "chocolate-inscription"],
  );
  assert.throws(
    () =>
      domain.priceCart(catalog, {
        items: [
          item("SET-12-FRESH", "B02", {
            addOns: [{ id: "whole-raspberry" }],
          }),
        ],
      }),
    (error) => error.code === "INVALID_ADDONS",
  );
});
test("A3/A7: multi-line order snapshots selected photos and refuses stale quoted total", () => {
  const r = raw([
    item(undefined, undefined, {
      addOns: [{ id: "chocolate-inscription" }],
      inscriptionText: "Тест",
    }),
    item("BQT-B09-FD", "B09"),
  ]);
  assert.throws(
    () => domain.normalizeOrder(catalog, r, { id: 100 }, now),
    (e) => e.code === "PRICE_CHANGED",
  );
  const o = domain.normalizeOrder(
    catalog,
    { ...r, expectedTotalKopecks: 373000 },
    { id: 100 },
    now,
  );
  assert.equal(o.items.length, 2);
  assert.equal(o.total, 3730);
  assert.equal(o.items[0].appearance.id, "A06");
  assert.equal(o.items[1].appearance.id, "B09");
  assert.ok(o.items[0].appearance.photoVersion);
  assert.equal(o.schedule.at, "2026-10-03T07:00:00.000Z");
  assert.equal(o.schedule.timeZone, "Europe/Moscow");
});
test("A6: holiday schedule, quarter-hour ceil and distant future preorders", () => {
  assert.equal(
    domain.slots(catalog, "SET-09-FRESH", "discovery", "2026-10-02", now)[0],
    "10:30",
  );
  assert.equal(
    domain.slots(catalog, "BQT-A07-FRESH", "discovery", "2026-10-02", now)[0],
    "11:00",
  );
  assert.equal(
    domain.slots(catalog, "SET-09-FD", "discovery", "2027-12-31", now)[0],
    "10:00",
  );
  const c = structuredClone(catalog);
  c.stores[0].dateOverrides = {
    "2026-10-03": { closed: true },
    "2026-10-04": { openTime: "12:10", closeTime: "16:00" },
  };
  assert.deepEqual(
    domain.slots(c, "SET-09-FD", "discovery", "2026-10-03", now),
    [],
  );
  assert.equal(
    domain.slots(c, "SET-09-FD", "discovery", "2026-10-04", now)[0],
    "12:15",
  );
});
test("A10: hold is based on pickup plus 24h, mixed items use earliest batch expiry", () => {
  const o = {
    status: "IN_PRODUCTION",
    fulfilment: { type: "pickup" },
    schedule: { date: "2026-10-02", time: "10:00" },
    items: [
      { variant: { type: "fresh" } },
      { variant: { type: "freeze_dried" } },
    ],
  };
  domain.validateTransition(
    o,
    "READY",
    {
      batches: [
        { manufacturedAt: "2026-10-02T06:00:00Z" },
        {
          manufacturedAt: "2026-09-01T06:00:00Z",
          expiresAt: "2026-11-01T06:00:00Z",
        },
      ],
    },
    now,
  );
  assert.equal(o.expiresAt, "2026-10-03T06:00:00.000Z");
  assert.equal(o.holdUntil, "2026-10-03T06:00:00.000Z");
  const fd = {
    status: "IN_PRODUCTION",
    fulfilment: { type: "pickup" },
    schedule: { date: "2026-10-02", time: "10:00" },
    variant: { type: "freeze_dried" },
  };
  domain.validateTransition(
    fd,
    "READY",
    {
      manufacturedAt: "2026-09-01T06:00:00Z",
      expiresAt: "2026-11-01T06:00:00Z",
    },
    now,
  );
  assert.equal(fd.holdUntil, "2026-10-03T07:00:00.000Z");
  assert.throws(
    () =>
      domain.validateTransition(
        { ...o, status: "READY" },
        "COMPLETED",
        {},
        new Date("2026-10-03T06:00:01Z"),
      ),
    (e) => e.code === "EXPIRED",
  );
});
