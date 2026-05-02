// Batch generator: walks docs/prop-wishlist.md and produces a {json,png}
// pair per prop. Shares one Vite dev server + one Chromium across the
// whole run so the per-prop overhead is just an LLM call + a single
// frame render. Skips props whose JSON+PNG already exist on disk so the
// run is restartable.

import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";
import { AssetGenerator } from "../server/asset-generator.ts";
import type { AssetSpec } from "../server/protocol.ts";
import { PROPS } from "./prop-wishlist.ts";



const OUT_DIR = resolve("./generated-assets");
const SIZE = 512;

async function fileExists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const generator = new AssetGenerator();

  console.log("[batch] starting Vite + Chromium…");
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    root: resolve("."),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "warn",
    clearScreen: false,
  });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === "string") throw new Error("vite: no http address");
  const url = `http://127.0.0.1:${addr.port}/scripts/render-page.html`;

  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (err) => console.error("[render-page]", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[render-page console]", msg.text());
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => (window as unknown as { __renderReady: boolean }).__renderReady === true,
    null,
    { timeout: 15_000 },
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  try {
    for (let i = 0; i < PROPS.length; i++) {
      const prop = PROPS[i]!;
      const jsonPath = join(OUT_DIR, `${prop.id}.json`);
      const pngPath = join(OUT_DIR, `${prop.id}.png`);
      const tag = `[${i + 1}/${PROPS.length}] ${prop.id}`;

      if ((await fileExists(jsonPath)) && (await fileExists(pngPath))) {
        console.log(`${tag} skip (exists)`);
        skipped++;
        continue;
      }

      console.log(`${tag} designing "${prop.description}" (${prop.mountKind} @ ${prop.slotOrAnchor})…`);
      let spec: AssetSpec | null = null;
      try {
        spec = await generator.generate({
          description: prop.description,
          mountKind: prop.mountKind,
          slotOrAnchor: prop.slotOrAnchor,
        });
      } catch (err) {
        console.error(`${tag} generate error:`, err);
      }
      if (!spec) {
        console.error(`${tag} FAILED (no spec)`);
        failed++;
        failures.push(prop.id);
        continue;
      }

      try {
        const dataUrl = await page.evaluate(
          (input) => window.__renderAsset(input),
          { spec, size: SIZE, mountKind: prop.mountKind },
        );
        if (!dataUrl.startsWith("data:image/png;base64,")) {
          throw new Error("non-PNG data url");
        }
        const buf = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
        await writeFile(jsonPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
        await writeFile(pngPath, buf);
        console.log(`${tag} wrote ${prop.id}.{json,png} (${spec.parts.length} parts)`);
        ok++;
      } catch (err) {
        console.error(`${tag} render error:`, err);
        failed++;
        failures.push(prop.id);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  console.log(
    `\n[batch] done: ${ok} written, ${skipped} skipped (already on disk), ${failed} failed`,
  );
  if (failures.length) {
    console.log("[batch] failures:", failures.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
