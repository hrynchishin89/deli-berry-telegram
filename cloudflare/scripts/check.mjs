import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const manifest = JSON.parse(await readFile("baseline-manifest.json", "utf8"));
for (const [name, expected] of Object.entries(manifest).filter(([name]) =>
  name.startsWith("assets/"),
))
  assert.equal(
    sha(await readFile("public/" + name)),
    expected,
    `Original asset changed: ${name}`,
  );
const catalog = JSON.parse(await readFile("public/catalog.json", "utf8"));
for (const a of catalog.appearances) {
  assert.ok(a.photoSource);
  assert.equal(
    sha(await readFile("public/" + a.photos[0])),
    a.photoVersion,
    `Appearance photo changed: ${a.id}`,
  );
}
for (const name of await readdir("src")) {
  const code = await readFile("src/" + name, "utf8");
  assert.doesNotMatch(code, /from\s+['"](?:node:|pg['"]|jose['"]|express['"])/);
  assert.doesNotMatch(code, /setInterval\(/);
}
const config = await readFile("wrangler.toml", "utf8");
for (const flag of [
  "ORDERS_ENABLED",
  "TELEGRAM_ENABLED",
  "OWNER_LIVE_APPROVED",
  "LIVE_PAYMENTS_APPROVED",
])
  assert.match(config, new RegExp(flag + ' = "false"'));
assert.match(config, /PAYMENT_MODE = "disabled"/);
console.log(
  "Original assets unchanged; approved appearance hashes verified. Edge runtime and disabled live gates verified.",
);
