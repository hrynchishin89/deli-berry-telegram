// Reproducible export/restore rehearsal with only synthetic local data.
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { normalizeOrder } from "../src/domain.mjs";
import catalog from "../public/catalog.json" with { type: "json" };
await mkdir("evidence", { recursive: true });
const dir = await mkdtemp(resolve(tmpdir(), "deli-restore-"));
const runner = resolve("node_modules/wrangler/bin/wrangler.js");
const config = (await readFile("wrangler.toml", "utf8"))
  .replace(
    'main = "src/worker.mjs"',
    "main = " + JSON.stringify(resolve("src/worker.mjs")),
  )
  .replace(
    'directory = "./public"',
    "directory = " + JSON.stringify(resolve("public")),
  )
  .replace(
    'migrations_dir = "migrations"',
    "migrations_dir = " + JSON.stringify(resolve("migrations")),
  );
for (const side of ["source", "restored"]) {
  await mkdir(dir + "/" + side);
  await writeFile(dir + "/" + side + "/wrangler.toml", config);
}
const run = (side, ...args) =>
  execFileSync(process.execPath, [runner, "--cwd", dir + "/" + side, ...args], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
const quote = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const o = normalizeOrder(
  catalog,
  {
    items: [
      {
        sku: "SET-12-A06",
        appearanceId: "A06",
        quantity: 1,
        addOns: [{ id: "chocolate-inscription" }],
        inscriptionText: "Проверка",
      },
    ],
    expectedTotalKopecks: 204000,
    store: { id: "discovery" },
    schedule: { date: "2099-01-10", time: "15:15" },
    customer: { name: "Синтетический тест", phone: "+79990000000" },
    fulfilment: { type: "pickup" },
    consent: true,
  },
  { id: 100 },
  new Date("2099-01-01T00:00:00Z"),
);
run("source", "d1", "migrations", "apply", "DB", "--local");
await writeFile(
  dir + "/seed.sql",
  `INSERT INTO users(telegram_id) VALUES('100');\nINSERT INTO orders(id,user_id,request_key,request_hash,store_id,status,total_kopecks,data) VALUES(${quote(o.id)},'100','restore-test-key-0001','synthetic','discovery','WAITING_CONFIRMATION',204000,${quote(JSON.stringify(o))});\nINSERT INTO order_events(order_id,actor,status,note) VALUES(${quote(o.id)},'customer:100','WAITING_CONFIRMATION','Synthetic restore rehearsal');`,
);
run("source", "d1", "execute", "DB", "--local", "--file", dir + "/seed.sql");
run("source", "d1", "export", "DB", "--local", "--output", dir + "/backup.sql");
run(
  "restored",
  "d1",
  "execute",
  "DB",
  "--local",
  "--file",
  dir + "/backup.sql",
);
const query =
  "SELECT o.id,o.status,o.total_kopecks,o.data,(SELECT COUNT(*) FROM order_events) events,(SELECT COUNT(*) FROM stores) stores FROM orders o";
const a = JSON.parse(
  run("source", "d1", "execute", "DB", "--local", "--command", query, "--json"),
)[0].results;
const b = JSON.parse(
  run(
    "restored",
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    query,
    "--json",
  ),
)[0].results;
assert.deepEqual(b, a);
assert.equal(b.length, 1);
assert.equal(b[0].stores, 2);
assert.equal(b[0].events, 1);
assert.equal(JSON.parse(b[0].data).items[0].appearance.id, "A06");
const report = {
  status: "PASS",
  scope: "LOCAL SYNTHETIC ONLY: actual live data backup NOT TESTED",
  orders: 1,
  events: 1,
  stores: 2,
  appearance: "A06",
  totalKopecks: 204000,
  exportBytes: Buffer.byteLength(await readFile(dir + "/backup.sql")),
  testedAt: new Date().toISOString(),
};
await writeFile(
  "evidence/restore-results.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
