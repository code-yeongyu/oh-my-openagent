import { describe, it, expect } from "bun:test";
import { canSpawnChild, incrementDepth } from "./depth-limiter";

describe("depth-limiter", () => {
  describe("canSpawnChild", () => {
    //#given depth 0 and max depth 1
    //#when checking if child can spawn
    //#then should return true (Coeus can spawn)
    it("returns true when currentDepth < maxDepth", () => {
      expect(canSpawnChild(0, 1)).toBe(true);
    });

    //#given depth 1 and max depth 1
    //#when checking if child can spawn
    //#then should return false (at max depth)
    it("returns false when currentDepth >= maxDepth", () => {
      expect(canSpawnChild(1, 1)).toBe(false);
    });

    //#given depth 2 and max depth 1
    //#when checking if child can spawn
    //#then should return false (exceeds max depth)
    it("returns false when currentDepth > maxDepth", () => {
      expect(canSpawnChild(2, 1)).toBe(false);
    });

    //#given depth 0 and max depth 5
    //#when checking if child can spawn
    //#then should return true
    it("returns true for deep nesting within limits", () => {
      expect(canSpawnChild(0, 5)).toBe(true);
      expect(canSpawnChild(3, 5)).toBe(true);
      expect(canSpawnChild(4, 5)).toBe(true);
    });

    //#given depth 5 and max depth 5
    //#when checking if child can spawn
    //#then should return false
    it("returns false at exact max depth", () => {
      expect(canSpawnChild(5, 5)).toBe(false);
    });
  });

  describe("incrementDepth", () => {
    //#given current depth 0
    //#when incrementing depth
    //#then should return 1
    it("increments depth by 1", () => {
      expect(incrementDepth(0)).toBe(1);
    });

    //#given current depth 5
    //#when incrementing depth
    //#then should return 6
    it("increments from any depth", () => {
      expect(incrementDepth(5)).toBe(6);
      expect(incrementDepth(10)).toBe(11);
    });

    //#given current depth -1 (edge case)
    //#when incrementing depth
    //#then should return 0
    it("handles negative depths", () => {
      expect(incrementDepth(-1)).toBe(0);
    });
  });
});
