// LOCAL SYNTHETIC DATA ONLY. No production tokens, Telegram calls or payments.
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
const port = Number(process.env.QA_PORT || 8787),
  root = resolve("public");
const compiled = await build({
  entryPoints: ["src/worker.mjs"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const temporary = await mkdtemp(resolve(tmpdir(), "deli-qa-"));
const mf = new Miniflare({
  host: "127.0.0.1",
  port,
  workers: [
    {
      name: "local-qa",
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-07-30",
      d1Databases: ["DB"],
      bindings: {
        SYNTHETIC_TEST_MODE: "true",
        TELEGRAM_BOT_TOKEN: "test-only-token",
        TELEGRAM_OPERATOR_ID: "900",
        ORDERS_ENABLED: process.env.QA_PREVIEW === "true" ? "false" : "true",
        TELEGRAM_ENABLED: "false",
        PAYMENT_MODE: "disabled",
        OWNER_LIVE_APPROVED: "true",
        LEGAL_APPROVED: "true",
        BUILD_COMMIT: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      },
      serviceBindings: {
        ASSETS: async (request) => {
          let pathname;
          try {
            pathname = decodeURIComponent(new URL(request.url).pathname);
          } catch {
            return new Response("", { status: 400 });
          }
          const file = resolve(
            root,
            "." + (pathname === "/" ? "/index.html" : pathname),
          );
          if (!file.startsWith(root + "/"))
            return new Response("", { status: 403 });
          try {
            return new Response(await readFile(file), {
              headers: {
                "Content-Type":
                  {
                    ".html": "text/html; charset=utf-8",
                    ".js": "application/javascript",
                    ".css": "text/css",
                    ".json": "application/json",
                    ".webp": "image/webp",
                  }[extname(file)] || "application/octet-stream",
                "Cache-Control": "no-store",
              },
            });
          } catch {
            return new Response("Not found", { status: 404 });
          }
        },
      },
    },
  ],
  d1Persist: temporary,
});
const db = await mf.getD1Database("DB");
for (const file of (await readdir("migrations")).sort())
  await db.exec(
    (await readFile("migrations/" + file, "utf8"))
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
console.log(
  JSON.stringify({
    url: String(await mf.ready),
    mode:
      process.env.QA_PREVIEW === "true" ? "public-preview" : "synthetic-local",
    telegram: "disabled",
    payment: "disabled",
  }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
