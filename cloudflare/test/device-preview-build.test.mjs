import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("device preview build is static, noindex and excludes private/order surfaces", async (t) => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const out = await mkdtemp(join(tmpdir(), "deli-berry-device-preview-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    ["scripts/build-device-preview.mjs", "--out", out],
    { cwd: project, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const files = await readdir(out, { recursive: true });
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("app.js"));
  assert.ok(files.includes("catalog-data.js"));
  assert.ok(files.includes("preview-config.js"));
  assert.ok(files.includes(".nojekyll"));
  assert.ok(files.some((name) => name.endsWith("B04.webp")));
  assert.ok(files.includes("assets/logo.webp"));
  assert.ok(!files.includes("assets/set-09.webp"));
  assert.ok(files.every((name) => !/operator|catalog\.json/i.test(name)));

  const index = await readFile(join(out, "index.html"), "utf8");
  assert.match(index, /name="robots" content="noindex,nofollow"/);
  assert.match(index, /catalog-data\.js[\s\S]*preview-config\.js[\s\S]*app\.js/);
  const config = await readFile(join(out, "preview-config.js"), "utf8");
  assert.match(config, /previewMode:\s*true/);
  assert.match(config, /ordersEnabled:\s*false/);
  assert.match(config, /dataCollectionEnabled:\s*false/);
  assert.match(config, /paymentEnabled:\s*false/);
  const data = await readFile(join(out, "catalog-data.js"), "utf8");
  assert.doesNotMatch(data, /whole-raspberry/);
  assert.doesNotMatch(data, /photoSource|photoVersion|mediaPending|registrationAddress/);

  const legal = await readFile(join(out, "legal.html"), "utf8");
  assert.match(legal, /name="robots" content="noindex,nofollow"/);
  assert.match(legal, /не принимает заказы и персональные данные/i);
  assert.doesNotMatch(legal, /не утвержд|до публичного запуска|боевой версии/i);
});

test("GitHub Pages preview verification does not invoke Cloudflare", async () => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const workflow = await readFile(
    join(project, "..", ".github", "workflows", "deploy-catalog.yml"),
    "utf8",
  );
  assert.match(workflow, /run:\s*npm run check:local/);
  assert.doesNotMatch(workflow, /wrangler|run:\s*npm run check\s*(?:\n|$)/);
});
