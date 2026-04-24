import { test, expect } from "bun:test";

test("sanity: bun test runs and discovers this file", () => {
  expect(1 + 1).toBe(2);
});
