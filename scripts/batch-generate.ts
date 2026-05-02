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

type Prop = {
  id: string;
  description: string;
  mountKind: "cosmetic" | "prop";
  slotOrAnchor: string;
};

// Hand-curated from docs/prop-wishlist.md. The wishlist groups by mount
// implicitly; we re-encode that here so each prop has an explicit
// (mountKind, slot/anchor). Held items default to hand_right; sky props
// to sky_center; ground props to ground_center.
const PROPS: Prop[] = [
  // Hats & headwear (head)
  c("wizard-hat", "wizard hat", "head"),
  c("crown", "crown", "head"),
  c("top-hat", "top hat", "head"),
  c("cowboy-hat", "cowboy hat", "head"),
  c("pirate-tricorn", "pirate tricorn", "head"),
  c("witch-hat", "witch hat", "head"),
  c("sombrero", "sombrero", "head"),
  c("baseball-cap", "baseball cap", "head"),
  c("party-hat", "party hat (cone with bobble)", "head"),
  c("beanie", "beanie", "head"),
  c("viking-helmet", "viking helmet with horns", "head"),
  c("knights-helmet", "knight's helmet", "head"),
  c("astronaut-helmet", "astronaut helmet", "head"),
  c("fire-helmet", "fire helmet", "head"),
  c("chefs-hat", "chef's hat", "head"),
  c("jester-hat", "jester hat with bells", "head"),
  c("propeller-beanie", "propeller beanie", "head"),
  c("crown-of-flowers", "crown of flowers", "head"),
  c("sailor-hat", "sailor hat", "head"),
  c("tiara", "tiara", "head"),

  // Eye accessories (eyes)
  c("sunglasses", "sunglasses", "eyes"),
  c("round-glasses", "round wire-frame glasses", "eyes"),
  c("star-sunglasses", "star-shaped sunglasses", "eyes"),
  c("heart-sunglasses", "heart-shaped sunglasses", "eyes"),
  c("monocle", "monocle", "eyes"),
  c("eye-patch", "eye patch", "eyes"),
  c("swim-goggles", "swim goggles", "eyes"),
  c("ski-goggles", "ski goggles", "eyes"),
  c("superhero-mask", "superhero bandit mask", "eyes"),
  c("masquerade-mask", "masquerade mask", "eyes"),

  // Neck accessories (neck)
  c("bowtie", "bowtie", "neck"),
  c("necktie", "necktie", "neck"),
  c("scarf", "scarf", "neck"),
  c("pearl-necklace", "pearl necklace", "neck"),
  c("heart-locket", "heart locket", "neck"),
  c("sheriff-badge", "sheriff badge", "neck"),
  c("olympic-medal", "olympic medal", "neck"),
  c("bandana", "bandana", "neck"),

  // Held items — tools, toys, magic (hand_right)
  c("magic-wand", "magic wand with star tip", "hand_right"),
  c("wooden-sword", "wooden sword", "hand_right"),
  c("pirate-cutlass", "pirate cutlass", "hand_right"),
  c("knights-lance", "knight's lance", "hand_right"),
  c("lightsaber", "lightsaber", "hand_right"),
  c("magic-staff", "magic staff", "hand_right"),
  c("royal-scepter", "royal scepter", "hand_right"),
  c("trident", "trident", "hand_right"),
  c("bow", "bow for arrows", "hand_right"),
  c("fishing-rod", "fishing rod", "hand_right"),
  c("baseball-bat", "baseball bat", "hand_right"),
  c("tennis-racket", "tennis racket", "hand_right"),
  c("hockey-stick", "hockey stick", "hand_right"),
  c("golf-club", "golf club", "hand_right"),
  c("broom", "broom", "hand_right"),
  c("mop", "mop", "hand_right"),
  c("microphone", "microphone", "hand_right"),
  c("paint-brush", "paint brush", "hand_right"),
  c("giant-pencil", "giant pencil", "hand_right"),
  c("magnifying-glass", "magnifying glass", "hand_right"),
  c("telescope", "telescope", "hand_right"),
  c("flashlight", "flashlight", "hand_right"),
  c("umbrella", "umbrella", "hand_right"),
  c("bouquet", "bouquet of flowers", "hand_right"),
  c("single-rose", "single rose", "hand_right"),
  c("lollipop", "lollipop", "hand_right"),

  // Held food (hand_right)
  c("ice-cream-cone", "ice cream cone", "hand_right"),
  c("hot-dog", "hot dog", "hand_right"),
  c("banana", "banana", "hand_right"),
  c("apple", "apple", "hand_right"),
  c("watermelon-slice", "watermelon slice", "hand_right"),
  c("pizza-slice", "pizza slice", "hand_right"),
  c("donut", "donut", "hand_right"),
  c("cupcake", "cupcake", "hand_right"),

  // Held creatures (hand_right)
  c("goldfish-bowl", "goldfish in a bowl", "hand_right"),
  c("butterfly-stick", "butterfly on a stick", "hand_right"),
  c("tiny-dragon", "tiny dragon", "hand_right"),
  c("pet-snake", "pet snake", "hand_right"),
  c("stuffed-bunny", "stuffed bunny", "hand_right"),

  // Scene props — sky
  p("sun", "sun", "sky_center"),
  p("full-moon", "full moon", "sky_center"),
  p("crescent-moon", "crescent moon", "sky_right"),
  p("single-star", "single star", "sky_right"),
  p("star-cluster", "cluster of stars", "sky_left"),
  p("cloud", "cloud", "sky_center"),
  p("rainbow", "rainbow", "sky_center"),
  p("lightning-bolt", "lightning bolt", "sky_center"),
  p("raindrop", "raindrop", "sky_center"),
  p("snowflake", "snowflake", "sky_center"),

  // Scene props — ground & nature
  p("mountain", "mountain", "ground_center"),
  p("pine-tree", "pine tree", "ground_center"),
  p("palm-tree", "palm tree", "ground_center"),
  p("giant-flower", "giant flower", "ground_center"),
  p("mushroom", "mushroom", "ground_center"),
  p("pumpkin", "pumpkin", "ground_center"),
  p("snowman", "snowman", "ground_center"),
  p("sand-castle", "sand castle", "ground_center"),
  p("beach-ball", "beach ball", "ground_center"),
  p("igloo", "igloo", "ground_center"),

  // Scene props — fantastical
  p("treasure-chest", "treasure chest", "ground_center"),
  p("hot-air-balloon", "hot air balloon", "far_back"),
  p("rocket-ship", "rocket ship", "ground_center"),
];

function c(id: string, description: string, slot: string): Prop {
  return { id, description, mountKind: "cosmetic", slotOrAnchor: slot };
}
function p(id: string, description: string, anchor: string): Prop {
  return { id, description, mountKind: "prop", slotOrAnchor: anchor };
}

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
