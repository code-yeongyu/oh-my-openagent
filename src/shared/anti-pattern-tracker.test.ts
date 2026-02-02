import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AntiPatternTracker, type FailedPattern } from "./anti-pattern-tracker";

describe("AntiPatternTracker", () => {
  //#region In-memory mode tests
  describe("in-memory mode", () => {
    let tracker: AntiPatternTracker;

    beforeEach(() => {
      //#given a new tracker without storage path
      tracker = new AntiPatternTracker();
    });

    it("should start with empty failed patterns", () => {
      //#when getting failed patterns from fresh tracker
      const patterns = tracker.getFailedPatterns();

      //#then should return empty array
      expect(patterns).toEqual([]);
    });

    it("should track a single failure", () => {
      //#given a pattern that failed
      const pattern = "using regex to parse HTML";
      const reason = "regex cannot handle nested structures";

      //#when tracking the failure
      tracker.trackFailure(pattern, reason);

      //#then should be retrievable
      const patterns = tracker.getFailedPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe(pattern);
      expect(patterns[0].reason).toBe(reason);
      expect(patterns[0].count).toBe(1);
      expect(patterns[0].timestamp).toBeGreaterThan(0);
    });

    it("should increment count for repeated failures", () => {
      //#given a pattern that fails multiple times
      const pattern = "direct DOM manipulation in React";
      const reason = "breaks React's reconciliation";

      //#when tracking the same pattern multiple times
      tracker.trackFailure(pattern, reason);
      tracker.trackFailure(pattern, reason);
      tracker.trackFailure(pattern, "different reason");

      //#then count should be incremented
      const patterns = tracker.getFailedPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(3);
    });

    it("should identify known failures", () => {
      //#given a tracked failure
      tracker.trackFailure("sync fs in async context", "blocks event loop");

      //#when checking if pattern is known
      const known = tracker.isKnownFailure("sync fs in async context");
      const unknown = tracker.isKnownFailure("some other pattern");

      //#then known patterns should return true
      expect(known).toBe(true);
      expect(unknown).toBe(false);
    });

    it("should clear all patterns", () => {
      //#given tracked failures
      tracker.trackFailure("pattern1", "reason1");
      tracker.trackFailure("pattern2", "reason2");

      //#when clearing
      tracker.clear();

      //#then should have no patterns
      expect(tracker.getFailedPatterns()).toEqual([]);
      expect(tracker.isKnownFailure("pattern1")).toBe(false);
    });

    it("should track multiple different patterns", () => {
      //#given multiple different failures
      tracker.trackFailure("pattern1", "reason1");
      tracker.trackFailure("pattern2", "reason2");
      tracker.trackFailure("pattern3", "reason3");

      //#when getting all patterns
      const patterns = tracker.getFailedPatterns();

      //#then all should be present
      expect(patterns).toHaveLength(3);
    });

    it("should update timestamp on repeated failure", async () => {
      //#given a pattern tracked earlier
      tracker.trackFailure("stale pattern", "old reason");
      const firstTimestamp = tracker.getFailedPatterns()[0].timestamp;

      //#when tracking again after a delay
      const delay = 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      tracker.trackFailure("stale pattern", "new reason");

      //#then timestamp should be updated
      const updatedTimestamp = tracker.getFailedPatterns()[0].timestamp;
      expect(updatedTimestamp).toBeGreaterThanOrEqual(firstTimestamp);
    });
  });
  //#endregion

  //#region Persistence mode tests
  describe("persistence mode", () => {
    let tracker: AntiPatternTracker;
    let testDir: string;
    let storagePath: string;

    beforeEach(() => {
      //#given a test directory for storage
      testDir = join(tmpdir(), `anti-pattern-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      storagePath = join(testDir, "anti-patterns.json");
      tracker = new AntiPatternTracker(storagePath);
    });

    afterEach(() => {
      //#cleanup test files
      if (existsSync(storagePath)) {
        unlinkSync(storagePath);
      }
      if (existsSync(testDir)) {
        rmdirSync(testDir);
      }
    });

    it("should persist patterns to file", () => {
      //#given a tracked failure
      tracker.trackFailure("persisted pattern", "persisted reason");

      //#when creating a new tracker with same path
      const newTracker = new AntiPatternTracker(storagePath);

      //#then should load persisted patterns
      const patterns = newTracker.getFailedPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe("persisted pattern");
    });

    it("should handle missing storage file gracefully", () => {
      //#given a path that doesn't exist
      const nonExistentPath = join(testDir, "nonexistent.json");
      const freshTracker = new AntiPatternTracker(nonExistentPath);

      //#when getting patterns
      const patterns = freshTracker.getFailedPatterns();

      //#then should return empty array
      expect(patterns).toEqual([]);
    });

    it("should handle corrupted storage file", async () => {
      //#given a corrupted storage file
      const { writeFileSync } = await import("node:fs");
      writeFileSync(storagePath, "not valid json {{{");

      //#when creating tracker with corrupted file
      const corruptedTracker = new AntiPatternTracker(storagePath);

      //#then should start fresh
      expect(corruptedTracker.getFailedPatterns()).toEqual([]);
    });

    it("should persist clear operation", () => {
      //#given persisted patterns
      tracker.trackFailure("to be cleared", "reason");
      
      //#when clearing and reloading
      tracker.clear();
      const newTracker = new AntiPatternTracker(storagePath);

      //#then should be empty
      expect(newTracker.getFailedPatterns()).toEqual([]);
    });

    it("should merge counts across sessions", () => {
      //#given a pattern tracked in first session
      tracker.trackFailure("session pattern", "reason");
      tracker.trackFailure("session pattern", "reason");

      //#when loading in new session and tracking again
      const newTracker = new AntiPatternTracker(storagePath);
      newTracker.trackFailure("session pattern", "reason");

      //#then count should accumulate
      const patterns = newTracker.getFailedPatterns();
      expect(patterns[0].count).toBe(3);
    });
  });
  //#endregion
});
