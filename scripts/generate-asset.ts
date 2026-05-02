// CLI: design a parametric AssetSpec from a text description and dump
// both the JSON and a PNG rendering to disk. Reuses AssetGenerator
// (Claude Opus 4.7) for the spec and the same THREE renderer the live
// app uses, run inside a headless Chromium via Playwright.
//
//   bun run gen:asset <id> <description> [flags]
//
// Flags:
//   --cosmetic            mountKind=cosmetic (default: prop)
//   --slot=<name>         slot for cosmetic (default: head)
//   --anchor=<name>       anchor for prop   (default: ground_center)
//   -o, --out <dir>       output directory  (default: ./generated-assets)
//   --size <px>           square render size (default: 512)
//   --force               overwrite existing files

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";
import { AssetGenerator } from "../server/asset-generator.ts";
import type { AssetSpec } from "../server/protocol.ts";

type Args = {
  id: string;
  description: string;
  mountKind: "cosmetic" | "prop";
  slotOrAnchor: string;
  outDir: string;
  size: number;
  force: boolean;
};

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let mountKind: "cosmetic" | "prop" = "prop";
  let slot: string | undefined;
  let anchor: string | undefined;
  let outDir = "./generated-assets";
  let size = 512;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--cosmetic") mountKind = "cosmetic";
    else if (a === "--prop") mountKind = "prop";
    else if (a === "--force") force = true;
    else if (a === "-o" || a === "--out") outDir = argv[++i] ?? outDir;
    else if (a.startsWith("--out=")) outDir = a.slice("--out=".length);
    else if (a === "--size") size = Number(argv[++i]);
    else if (a.startsWith("--size=")) size = Number(a.slice("--size=".length));
    else if (a.startsWith("--slot=")) slot = a.slice("--slot=".length);
    else if (a === "--slot") slot = argv[++i];
    else if (a.startsWith("--anchor=")) anchor = a.slice("--anchor=".length);
    else if (a === "--anchor") anchor = argv[++i];
    else if (a.startsWith("-")) die(`unknown flag: ${a}`);
    else positional.push(a);
  }

  const [id, ...descParts] = positional;
  const description = descParts.join(" ").trim();
  if (!id || !description) {
    die('usage: bun run gen:asset <id> "<description>" [flags]');
  }
  if (!ID_RE.test(id)) {
    die(`invalid id "${id}" — must match ${ID_RE} (lowercase, kebab/snake-case)`);
  }
  if (!Number.isFinite(size) || size < 64 || size > 4096) {
    die(`invalid --size ${size} (must be 64..4096)`);
  }

  const slotOrAnchor =
    mountKind === "cosmetic" ? (slot ?? "head") : (anchor ?? "ground_center");

  return { id, description, mountKind, slotOrAnchor, outDir, size, force };
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY) {
    die("ANTHROPIC_API_KEY is not set. Export it before running gen:asset.");
  }
  const outDir = resolve(args.outDir);
  const jsonPath = join(outDir, `${args.id}.json`);
  const pngPath = join(outDir, `${args.id}.png`);

  await mkdir(outDir, { recursive: true });

  if (!args.force) {
    if ((await fileExists(jsonPath)) || (await fileExists(pngPath))) {
      die(`refusing to overwrite ${args.id}.{json,png} in ${outDir} (pass --force)`);
    }
  }

  console.log(
    `[gen] designing "${args.description}" as ${args.mountKind} @ ${args.slotOrAnchor}…`,
  );
  const generator = new AssetGenerator();
  const spec = await generator.generate({
    description: args.description,
    mountKind: args.mountKind,
    slotOrAnchor: args.slotOrAnchor,
  });
  if (!spec) die("[gen] asset generation failed (see logs above)");

  await writeFile(jsonPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
  console.log(`[gen] wrote ${jsonPath} (${spec.parts.length} parts)`);

  await renderToPNG(spec, args, pngPath);
  console.log(`[gen] wrote ${pngPath}`);
}

async function renderToPNG(spec: AssetSpec, args: Args, pngPath: string) {
  let server: ViteDevServer | undefined;
  let browser: Browser | undefined;
  try {
    server = await createServer({
      configFile: resolve("vite.config.ts"),
      root: resolve("."),
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
      logLevel: "warn",
      clearScreen: false,
    });
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === "string") throw new Error("vite: no http address");
    const url = `http://127.0.0.1:${addr.port}/scripts/render-page.html`;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: args.size, height: args.size },
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

    const dataUrl = await page.evaluate(
      (input) => window.__renderAsset(input),
      { spec, size: args.size, mountKind: args.mountKind },
    );
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("render-page returned non-PNG data URL");
    }
    const buf = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    await writeFile(pngPath, buf);
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
