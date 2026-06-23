import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import {
  slugifyLabel,
  validateLabelOrThrow,
  recordingsRoot,
  legacyRecordingPath,
  enhancedRecordingDir,
  enhancedRecordingPaths,
  isEnhancedRecording,
  isLegacyRecording,
  listRecordings,
  RecordingLabelError,
} from "./recording-directory";

describe("recording-directory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "idm-hermes-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("slugifyLabel", () => {
    test("#given valid label #when slugifyLabel #then returns deterministic slug", () => {
      expect(slugifyLabel("DeepSeek Signup")).toBe("deepseek-signup");
    });

    test("#given label with spaces #when slugifyLabel #then collapses to dashes", () => {
      expect(slugifyLabel("  My   Recording  ")).toBe("my-recording");
    });

    test("#given label with special chars #when slugifyLabel #then strips them", () => {
      expect(slugifyLabel("Recording! @123")).toBe("recording-123");
    });
  });

  describe("validateLabelOrThrow", () => {
    test("#given valid label #when validateLabelOrThrow #then does not throw", () => {
      expect(() => validateLabelOrThrow("valid-label")).not.toThrow();
    });

    test("#given label > 64 chars #when validateLabelOrThrow #then throws RecordingLabelError", () => {
      const longLabel = "a".repeat(65);
      expect(() => validateLabelOrThrow(longLabel)).toThrow(RecordingLabelError);
    });

    test("#given label that changes after slugify #when validateLabelOrThrow #then throws RecordingLabelError", () => {
      expect(() => validateLabelOrThrow("Invalid Label")).toThrow(RecordingLabelError);
    });

    test("#given empty label #when validateLabelOrThrow #then throws RecordingLabelError", () => {
      expect(() => validateLabelOrThrow("")).toThrow(RecordingLabelError);
    });
  });

  describe("paths", () => {
    test("recordingsRoot returns expected path", () => {
      // We can't easily mock homedir() without a lot of effort, but we can check the suffix
      expect(recordingsRoot()).toContain(join("Library", "Caches", "idm", "sessions"));
    });

    test("legacyRecordingPath returns expected path", () => {
      const root = recordingsRoot();
      expect(legacyRecordingPath("abc")).toBe(join(root, "abc.jsonl"));
    });

    test("enhancedRecordingDir returns expected path", () => {
      const root = recordingsRoot();
      expect(enhancedRecordingDir("my-rec")).toBe(join(root, "my-rec"));
    });

    test("enhancedRecordingPaths returns all paths", () => {
      const paths = enhancedRecordingPaths("my-rec");
      const dir = enhancedRecordingDir("my-rec");
      expect(paths.dir).toBe(dir);
      expect(paths.sessionJsonl).toBe(join(dir, "session.jsonl"));
      expect(paths.metadataJson).toBe(join(dir, "metadata.json"));
      expect(paths.visionCheckpointsDir).toBe(join(dir, "vision-checkpoints"));
    });
  });

  describe("classification and listing", () => {
    test("#given empty recordings dir #when listRecordings #then returns []", () => {
      // We need to pass the root to listRecordings for testing
      expect(listRecordings(tempDir)).toEqual([]);
    });

    test("#given mixed legacy + enhanced #when listRecordings #then classifies each correctly", () => {
      // Setup fixtures
      const legacyFile = join(tempDir, "legacy-1.jsonl");
      writeFileSync(legacyFile, "{}");

      const enhancedDir = join(tempDir, "enhanced-1");
      mkdirSync(enhancedDir);
      writeFileSync(join(enhancedDir, "metadata.json"), "{}");

      const otherFile = join(tempDir, "other.txt");
      writeFileSync(otherFile, "text");

      const results = listRecordings(tempDir);
      expect(results).toHaveLength(2);
      
      const legacy = results.find(r => r.name === "legacy-1");
      expect(legacy?.kind).toBe("legacy");
      expect(legacy?.path).toBe(legacyFile);

      const enhanced = results.find(r => r.name === "enhanced-1");
      expect(enhanced?.kind).toBe("enhanced");
      expect(enhanced?.path).toBe(enhancedDir);
    });

    test("isEnhancedRecording identifies correctly", () => {
      const dir = join(tempDir, "rec");
      mkdirSync(dir);
      expect(isEnhancedRecording(dir)).toBe(false);
      writeFileSync(join(dir, "metadata.json"), "{}");
      expect(isEnhancedRecording(dir)).toBe(true);
    });

    test("isLegacyRecording identifies correctly", () => {
      const file = join(tempDir, "rec.jsonl");
      expect(isLegacyRecording(file)).toBe(false);
      writeFileSync(file, "{}");
      expect(isLegacyRecording(file)).toBe(true);
      
      const notJsonl = join(tempDir, "rec.txt");
      writeFileSync(notJsonl, "{}");
      expect(isLegacyRecording(notJsonl)).toBe(false);
    });
  });
});
