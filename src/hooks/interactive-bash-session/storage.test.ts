import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testStorageDir = "";

mock.module("./constants", () => ({
  INTERACTIVE_BASH_SESSION_STORAGE: testStorageDir,
}));

const storageModulePromise = import("./storage");

describe("interactive bash session storage", () => {
  beforeEach(() => {
    testStorageDir = mkdtempSync(join(tmpdir(), "omo-interactive-bash-storage-"));
  });

  afterEach(() => {
    rmSync(testStorageDir, { recursive: true, force: true });
  });

  it("#given corrupted persisted state #when loading session state #then returns null", async () => {
    // given
    writeFileSync(join(testStorageDir, "session-1.json"), "{not json");
    const { loadInteractiveBashSessionState } = await storageModulePromise;

    // when
    const result = loadInteractiveBashSessionState("session-1");

    // then
    expect(result).toBeNull();
  });
});
