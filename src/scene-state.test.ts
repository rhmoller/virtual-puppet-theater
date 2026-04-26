import { test, expect } from "bun:test";
import { SceneState, applyStateEffect } from "./scene-state";
import type { AssetSpec, Effect } from "../server/protocol";

test("dress / undress updates the worn map and returns previous value", () => {
  const s = new SceneState();
  expect(s.dress("ai", "head", "top_hat")).toBe(null);
  expect(s.wornBy("ai").head).toBe("top_hat");
  expect(s.dress("ai", "head", "crown")).toBe("top_hat");
  expect(s.wornBy("ai").head).toBe("crown");
  expect(s.dress("ai", "head", null)).toBe("crown");
  expect(s.wornBy("ai").head).toBeUndefined();
});

test("place / unplace mirrors dress on the anchor map", () => {
  const s = new SceneState();
  s.place("sky_right", "moon");
  expect(s.at("sky_right")).toBe("moon");
  s.place("sky_right", null);
  expect(s.at("sky_right")).toBe(null);
});

test("resolveAsset prefers generated over pre-fab when names collide", () => {
  const s = new SceneState();
  expect(s.resolveAsset("top_hat")).not.toBeNull(); // catalog
  const fake: AssetSpec = { parts: [{ shape: "sphere", color: 0xffffff }] };
  s.registerGenerated("top_hat", fake);
  expect(s.resolveAsset("top_hat")).toBe(fake);
});

test("resolveAsset returns null for unknown names", () => {
  const s = new SceneState();
  expect(s.resolveAsset("doesnt_exist")).toBe(null);
});

test("applyStateEffect routes dress/place/request to the right state changes", () => {
  const s = new SceneState();
  const effects: Effect[] = [
    { op: "dress", puppet: "user", slot: "eyes", asset: "sunglasses" },
    { op: "place", anchor: "ground_left", asset: "sand_castle" },
    {
      op: "request_cosmetic",
      puppet: "ai",
      slot: "head",
      description: "watermelon hat",
      request_id: "r1",
    },
  ];
  for (const e of effects) applyStateEffect(s, e);
  expect(s.wornBy("user").eyes).toBe("sunglasses");
  expect(s.at("ground_left")).toBe("sand_castle");
  const pending = s.consumePending("r1");
  expect(pending).toEqual({
    kind: "cosmetic",
    puppet: "ai",
    slot: "head",
    description: "watermelon hat",
  });
  // Once consumed, second consume returns null.
  expect(s.consumePending("r1")).toBe(null);
});

test("describe summarises the scene compactly", () => {
  const s = new SceneState();
  s.dress("ai", "head", "crown");
  s.dress("user", "eyes", "sunglasses");
  s.place("sky_right", "moon");
  const out = s.describe();
  expect(out).toContain("ai{");
  expect(out).toContain("crown");
  expect(out).toContain("user{");
  expect(out).toContain("sunglasses");
  expect(out).toContain("placed{");
  expect(out).toContain("moon");
});

test("describe returns 'empty' for a fresh state", () => {
  const s = new SceneState();
  expect(s.describe()).toBe("empty");
});
