// Refinement feedback loop: pick 10 random props, generate each, render
// to PNG, run Opus over the PNG to critique it spatially, then generate
// a refined version with the critique as guidance, render that too, and
// critique the refined version. Six artifacts per prop:
//
//   <id>.json              first-pass spec
//   <id>.png               first-pass render
//   <id>-eval.txt          first-pass critique
//   <id>-refined.json      refined spec
//   <id>-refined.png       refined render
//   <id>-refined-eval.txt  refined critique
//
// The refinement step appends the critique to the AssetGenerator's user
// prompt as targeted guidance — see `guidance` option in
// server/asset-generator.ts. The critique speaks directly to the
// designer in actionable language so the LLM can apply each item.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { AssetGenerator } from "../server/asset-generator.ts";
import type { AssetSpec } from "../server/protocol.ts";
import { PROPS, type Prop } from "./prop-wishlist.ts";

const OUT_DIR = resolve("./generated-assets");
const SIZE = 512;
const SAMPLE_SIZE = 10;
const CRITIQUE_MODEL = "claude-opus-4-7";

// Prompt for the critique step. The critique is consumed by the next
// AssetGenerator call as guidance, so it should speak directly to the
// designer with concrete actionable items rather than narrate the image
// for a human reader.
const CRITIQUE_INSTRUCTIONS = `You are reviewing a 3D-rendered prop produced by another instance of yourself. The image attached is the rendered output. Your critique will be fed back to the designer as refinement guidance for the next attempt.

Output a critique with two sections:

PROBLEMS — list 3-8 concrete issues you see in the image. For each issue:
- name the part involved (e.g. "the left wing", "the brim", "the legs")
- describe what's wrong spatially (floating, wrong orientation, overlapping wrong, missing connection, wrong shape, wrong proportion, wrong color)
- if the asset reads well overall, note that explicitly and limit problems to refinements

CORRECTIONS — for each problem, give a specific actionable instruction the designer can apply, e.g. "move the leg position.y from 0.05 up to 0.85 so the leg top overlaps the body bottom by 0.1" or "switch the wing contour from rectangular to triangular ([[-0.5,-0.1],[0.5,-0.1],[0,0.5]])". Reference part fields (position, scale, contour, taper, cap_start, etc.) by name. Be quantitative when possible.

Keep the critique under 500 words. Speak in the imperative ("move", "replace", "narrow") not in summary ("the leg should be moved"). If a part is good, do not mention it — focus on what to change.`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await (await import("node:fs/promises")).access(p);
    return true;
  } catch {
    return false;
  }
}

async function renderSpec(
  page: Page,
  spec: AssetSpec,
  mountKind: "cosmetic" | "prop",
  size: number,
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    (input) => window.__renderAsset(input),
    { spec, size, mountKind },
  );
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("renderer returned non-PNG data URL");
  }
  return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
}

async function critique(
  client: Anthropic,
  pngBuf: Buffer,
  description: string,
  mountKind: "cosmetic" | "prop",
  slotOrAnchor: string,
): Promise<string> {
  const b64 = pngBuf.toString("base64");
  const where =
    mountKind === "cosmetic"
      ? `worn at slot "${slotOrAnchor}"`
      : `placed at scene anchor "${slotOrAnchor}"`;
  const response = await client.messages.create({
    model: CRITIQUE_MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: b64 },
          },
          {
            type: "text",
            text: `Brief: "${description}" (${where}).\n\n${CRITIQUE_INSTRUCTIONS}`,
          },
        ],
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("critique: no text block in response");
  }
  return block.text;
}

async function processProp(
  prop: Prop,
  generator: AssetGenerator,
  client: Anthropic,
  page: Page,
  index: number,
  total: number,
): Promise<{ ok: boolean; reason?: string }> {
  const tag = `[${index + 1}/${total}] ${prop.id}`;
  const jsonPath = (suffix: string) => join(OUT_DIR, `${prop.id}${suffix}.json`);
  const pngPath = (suffix: string) => join(OUT_DIR, `${prop.id}${suffix}.png`);
  const evalPath = (suffix: string) => join(OUT_DIR, `${prop.id}${suffix}-eval.txt`);

  // ── Pass 1: initial generation ────────────────────────────────────
  console.log(`${tag} pass 1 — designing "${prop.description}"…`);
  const spec1 = await generator.generate({
    description: prop.description,
    mountKind: prop.mountKind,
    slotOrAnchor: prop.slotOrAnchor,
    bypassCache: true,
  });
  if (!spec1) return { ok: false, reason: "pass 1 failed" };
  await writeFile(jsonPath(""), JSON.stringify(spec1, null, 2) + "\n", "utf8");
  const png1 = await renderSpec(page, spec1, prop.mountKind, SIZE);
  await writeFile(pngPath(""), png1);
  console.log(`${tag} pass 1 wrote ${prop.id}.{json,png} (${spec1.parts.length} parts)`);

  // ── Critique 1 ────────────────────────────────────────────────────
  console.log(`${tag} pass 1 — critiquing render…`);
  const eval1 = await critique(client, png1, prop.description, prop.mountKind, prop.slotOrAnchor);
  await writeFile(evalPath(""), eval1, "utf8");

  // ── Pass 2: refinement ────────────────────────────────────────────
  console.log(`${tag} pass 2 — refining with critique…`);
  const spec2 = await generator.generate({
    description: prop.description,
    mountKind: prop.mountKind,
    slotOrAnchor: prop.slotOrAnchor,
    guidance: eval1,
    bypassCache: true,
  });
  if (!spec2) return { ok: false, reason: "pass 2 failed" };
  await writeFile(jsonPath("-refined"), JSON.stringify(spec2, null, 2) + "\n", "utf8");
  const png2 = await renderSpec(page, spec2, prop.mountKind, SIZE);
  await writeFile(pngPath("-refined"), png2);
  console.log(`${tag} pass 2 wrote ${prop.id}-refined.{json,png} (${spec2.parts.length} parts)`);

  // ── Critique 2 ────────────────────────────────────────────────────
  console.log(`${tag} pass 2 — critiquing refined render…`);
  const eval2 = await critique(client, png2, prop.description, prop.mountKind, prop.slotOrAnchor);
  await writeFile(evalPath("-refined"), eval2, "utf8");

  console.log(`${tag} done`);
  return { ok: true };
}

function pickSample(props: Prop[], n: number): Prop[] {
  const copy = [...props];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const sample = pickSample(PROPS, SAMPLE_SIZE);
  console.log(`[refine] sampled ${sample.length} props:`);
  for (const p of sample) console.log(`  - ${p.id} (${p.mountKind} @ ${p.slotOrAnchor})`);

  const client = new Anthropic();
  const generator = new AssetGenerator();

  console.log("[refine] starting Vite + Chromium…");
  const server: ViteDevServer = await createServer({
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
  let failed = 0;
  const failures: { id: string; reason?: string }[] = [];
  try {
    for (let i = 0; i < sample.length; i++) {
      try {
        const result = await processProp(sample[i]!, generator, client, page, i, sample.length);
        if (result.ok) ok++;
        else {
          failed++;
          failures.push({ id: sample[i]!.id, reason: result.reason });
        }
      } catch (err) {
        failed++;
        failures.push({
          id: sample[i]!.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        console.error(`[refine] error on ${sample[i]!.id}:`, err);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  console.log(`\n[refine] done: ${ok} succeeded, ${failed} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ! ${f.id}: ${f.reason ?? "unknown"}`);
    process.exit(1);
  }
}

// Silence unused-import warning if fileExists ends up unused.
void fileExists;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
