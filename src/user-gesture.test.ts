import { describe, it, expect } from "bun:test";
import type { NormalizedLandmarkList, LandmarkList } from "@mediapipe/hands";
import { GestureDetector, classifyStatic } from "./user-gesture";
import type { UserGesture } from "../server/protocol";

// ---- classifyStatic — boolean inputs only, exhaustive cases ----

describe("classifyStatic", () => {
  type Ext = [boolean, boolean, boolean, boolean, boolean];
  const make = (t: number, i: number, m: number, r: number, p: number): Ext =>
    [!!t, !!i, !!m, !!r, !!p];

  const cases: Array<[string, Ext, UserGesture | null]> = [
    ["thumbs_up", make(1, 0, 0, 0, 0), "thumbs_up"],
    ["peace (thumb folded)", make(0, 1, 1, 0, 0), "peace"],
    ["peace (thumb out)", make(1, 1, 1, 0, 0), "peace"],
    ["fist", make(0, 0, 0, 0, 0), "fist"],
    ["open_palm", make(1, 1, 1, 1, 1), "open_palm"],
    ["point", make(0, 1, 0, 0, 0), "point"],
    // rejecting cases
    ["index+pinky (rock)", make(0, 1, 0, 0, 1), null],
    ["thumb+index (gun)", make(1, 1, 0, 0, 0), null],
    ["3 middle fingers", make(0, 0, 1, 1, 1), null],
    ["4 fingers no thumb", make(0, 1, 1, 1, 1), null],
  ];

  for (const [name, ext, expected] of cases) {
    it(`${name} → ${expected ?? "null"}`, () => {
      expect(classifyStatic(ext)).toBe(expected);
    });
  }
});

// ---- GestureDetector integration ----
//
// Fixtures: build minimal landmark arrays directly; the detector only
// reads specific indices. We don't need realistic anatomy, just numbers
// that satisfy the finger-extension ratio for the gesture under test.

function make21<T>(fill: T): T[] {
  return Array.from({ length: 21 }, () => fill);
}

/**
 * Build a world LandmarkList where each finger is either extended or
 * folded. Tip distance from wrist is set so the ratio against the MCP
 * joint exceeds (or doesn't) the detector's threshold.
 */
function makeWorld(extended: { thumb: boolean; idx: boolean; mid: boolean; ring: boolean; pinky: boolean }): LandmarkList {
  const lm = make21({ x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number }[];
  // wrist at origin (0)
  lm[0] = { x: 0, y: 0, z: 0 };
  // For each finger: place MCP at distance 1 along an axis, place tip
  // either at distance >2 (extended) or <1 (folded).
  const setFinger = (mcpIdx: number, tipIdx: number, axis: number, ext: boolean) => {
    const sign = axis === 0 ? 1 : axis === 1 ? -1 : 1;
    lm[mcpIdx] = { x: axis === 0 ? sign : 0, y: axis === 1 ? sign : 1, z: 0 };
    const tipDist = ext ? 2.5 : 0.5;
    lm[tipIdx] = { x: axis === 0 ? sign * tipDist : 0, y: axis === 1 ? sign * tipDist : tipDist, z: 0 };
  };
  // thumb uses index 2 (IP) as joint
  lm[2] = { x: 1, y: 0, z: 0 };
  lm[4] = { x: extended.thumb ? 2 : 0.7, y: 0, z: 0 };
  setFinger(5, 8, 1, extended.idx);
  setFinger(9, 12, 1, extended.mid);
  setFinger(13, 16, 1, extended.ring);
  setFinger(17, 20, 1, extended.pinky);
  return lm as LandmarkList;
}

/** Build a normalized lm at a given palm center (the only thing the
 *  detector reads from lm). All five "palm" indices share the same x,y. */
function makeLm(x: number, y: number): NormalizedLandmarkList {
  const arr = make21({ x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number }[];
  for (const i of [0, 5, 9, 13, 17]) arr[i] = { x, y, z: 0 };
  return arr as NormalizedLandmarkList;
}

const WORLD_FIST = makeWorld({ thumb: false, idx: false, mid: false, ring: false, pinky: false });
const WORLD_OPEN = makeWorld({ thumb: true, idx: true, mid: true, ring: true, pinky: true });
const WORLD_THUMBS_UP = makeWorld({ thumb: true, idx: false, mid: false, ring: false, pinky: false });

describe("GestureDetector — static gesture rising-edge + cooldown", () => {
  it("emits thumbs_up once when the pose appears, suppresses while held", () => {
    const d = new GestureDetector();
    // 10 frames of thumbs_up — one rising edge → one emit.
    for (let i = 0; i < 10; i++) {
      d.observe({
        lm: makeLm(0.5, 0.5),
        world: WORLD_THUMBS_UP,
        mouthOpen: 0.5,
        roll: 0,
        dt: 1 / 30,
      });
    }
    const drained = d.drainGestures();
    expect(drained.filter((g) => g === "thumbs_up").length).toBe(1);
  });

  it("re-emits a gesture after the cooldown elapses and the pose is re-entered", () => {
    const d = new GestureDetector();
    // Show thumbs_up, then fist (resets prevStatic), then thumbs_up again
    // after the cooldown.
    const tick = (world: LandmarkList, dt: number) =>
      d.observe({ lm: makeLm(0.5, 0.5), world, mouthOpen: 0.2, roll: 0, dt });
    tick(WORLD_THUMBS_UP, 1 / 30);
    expect(d.drainGestures()).toContain("thumbs_up");
    // Hold fist for 1.2s — past the 1.0s cooldown.
    for (let i = 0; i < 36; i++) tick(WORLD_FIST, 1 / 30);
    d.drainGestures(); // discard the fist emit
    tick(WORLD_THUMBS_UP, 1 / 30);
    expect(d.drainGestures()).toContain("thumbs_up");
  });
});

describe("GestureDetector — wave", () => {
  it("emits wave when palm-x oscillates", () => {
    const d = new GestureDetector();
    const dt = 1 / 30;
    // 1.2s of sinusoidal palm-x oscillation at 2 Hz, amplitude 0.1.
    for (let i = 0; i < 36; i++) {
      const t = i * dt;
      const x = 0.5 + 0.1 * Math.sin(t * Math.PI * 2 * 2);
      d.observe({ lm: makeLm(x, 0.5), world: WORLD_OPEN, mouthOpen: 0.5, roll: 0, dt });
    }
    expect(d.drainGestures()).toContain("wave");
  });

  it("does not emit wave for a still hand", () => {
    const d = new GestureDetector();
    for (let i = 0; i < 36; i++) {
      d.observe({
        lm: makeLm(0.5, 0.5),
        world: WORLD_OPEN,
        mouthOpen: 0.5,
        roll: 0,
        dt: 1 / 30,
      });
    }
    expect(d.drainGestures().includes("wave")).toBe(false);
  });
});

describe("GestureDetector — jump", () => {
  it("emits jump on a fast up-then-down palm motion", () => {
    const d = new GestureDetector();
    const dt = 1 / 30;
    // Baseline at y=0.6 for 5 frames.
    for (let i = 0; i < 5; i++) {
      d.observe({ lm: makeLm(0.5, 0.6), world: WORLD_OPEN, mouthOpen: 0, roll: 0, dt });
    }
    // Up over 4 frames (~133ms), travelling y from 0.6 → 0.3 (negative dy = up).
    for (let i = 1; i <= 4; i++) {
      const y = 0.6 - (0.3 * i) / 4;
      d.observe({ lm: makeLm(0.5, y), world: WORLD_OPEN, mouthOpen: 0, roll: 0, dt });
    }
    // Down over 4 frames back to 0.6.
    for (let i = 1; i <= 4; i++) {
      const y = 0.3 + (0.3 * i) / 4;
      d.observe({ lm: makeLm(0.5, y), world: WORLD_OPEN, mouthOpen: 0, roll: 0, dt });
    }
    expect(d.drainGestures()).toContain("jump");
  });
});

describe("GestureDetector — pose stickiness", () => {
  it("flips to upside_down only after the hold duration", () => {
    const d = new GestureDetector();
    // At π roll for 0.3s — under the 0.5s threshold.
    for (let i = 0; i < 9; i++) {
      d.observe({
        lm: makeLm(0.5, 0.5),
        world: WORLD_OPEN,
        mouthOpen: 0,
        roll: Math.PI,
        dt: 1 / 30,
      });
    }
    expect(d.pose).toBe("normal");
    // Continue past 0.5s.
    for (let i = 0; i < 12; i++) {
      d.observe({
        lm: makeLm(0.5, 0.5),
        world: WORLD_OPEN,
        mouthOpen: 0,
        roll: Math.PI,
        dt: 1 / 30,
      });
    }
    expect(d.pose).toBe("upside_down");
    // Snap back to normal once roll returns.
    d.observe({
      lm: makeLm(0.5, 0.5),
      world: WORLD_OPEN,
      mouthOpen: 0,
      roll: 0,
      dt: 1 / 30,
    });
    expect(d.pose).toBe("normal");
  });

  it("flips to sleeping after sustained idle conditions", () => {
    const d = new GestureDetector();
    // The first frame of a fist fires a "fist" gesture emission.
    // Sleeping requires no recent gestures (1.5s window) for a hold of 3s,
    // so we need ≥4.5s of total still time before the pose flips.
    // Run 6s to be safe.
    for (let i = 0; i < 180; i++) {
      d.observe({
        lm: makeLm(0.5, 0.5),
        world: WORLD_FIST,
        mouthOpen: 0,
        roll: 0,
        dt: 1 / 30,
      });
    }
    d.drainGestures();
    expect(d.pose).toBe("sleeping");
    expect(d.energy).toBe("low");
  });
});

describe("GestureDetector — energy", () => {
  it("reports high after a wave", () => {
    const d = new GestureDetector();
    for (let i = 0; i < 36; i++) {
      const t = i / 30;
      const x = 0.5 + 0.1 * Math.sin(t * Math.PI * 2 * 2);
      d.observe({ lm: makeLm(x, 0.5), world: WORLD_OPEN, mouthOpen: 0.5, roll: 0, dt: 1 / 30 });
    }
    expect(d.energy).toBe("high");
  });

  it("reports low when no hand has been observed", () => {
    const d = new GestureDetector();
    d.notifyAbsent(0.5);
    expect(d.energy).toBe("low");
  });
});
