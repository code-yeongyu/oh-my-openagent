import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createImportSuffix(): string {
  return `?test=${Date.now()}-${Math.random()}`;
}

describe("createRuleScanCache", () => {
  afterEach(() => {
    mock.restore();
  });

  it("returns undefined before set, returns stored value, and clears entries", async () => {
    // given
    const { createRuleScanCache } = await import(`./rule-scan-cache${createImportSuffix()}`);
    const cache = createRuleScanCache();
    const value = ["a", "b"];

    // when
    const initialValue = cache.get("k1");
    cache.set("k1", value);
    const storedValue = cache.get("k1");
    cache.clear();
    const clearedValue = cache.get("k1");

    // then
    expect(initialValue).toBeUndefined();
    expect(storedValue).toEqual(value);
    expect(clearedValue).toBeUndefined();
  });
});

describe("findRuleFiles with scan cache", () => {
  let testRoot = "";
  let homeDir = "";
  let projectRoot = "";
  let currentFile = "";
  let expectedRuleFile = "";
  let expectedRuleDir = "";

  beforeEach(() => {
    testRoot = join(tmpdir(), `rule-scan-cache-test-${Date.now()}`);
    homeDir = join(testRoot, "home");
    projectRoot = join(testRoot, "project");
    currentFile = join(projectRoot, "src", "index.ts");
    expectedRuleDir = join(projectRoot, ".github", "instructions");
    expectedRuleFile = join(expectedRuleDir, "typescript.instructions.md");

    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(currentFile, "export const value = 1;\n");
  });

  afterEach(() => {
    mock.restore();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reuses cached directory scan results for identical inputs", async () => {
    // given
    const findRuleFilesRecursive = mock((directoryPath: string, results: string[]) => {
      if (directoryPath === expectedRuleDir) {
        results.push(expectedRuleFile);
      }
    });

    mock.module("./rule-file-scanner", () => ({
      findRuleFilesRecursive,
      safeRealpathSync: (filePath: string) => filePath,
    }));

    const { createRuleScanCache } = await import(`./rule-scan-cache${createImportSuffix()}`);
    const { findRuleFiles } = await import(`./rule-file-finder${createImportSuffix()}`);
    const cache = createRuleScanCache();

    // when
    const firstCandidates = findRuleFiles(projectRoot, homeDir, currentFile, undefined, cache);
    const firstInvocationCount = findRuleFilesRecursive.mock.calls.length;
    const secondCandidates = findRuleFiles(projectRoot, homeDir, currentFile, undefined, cache);

    // then
    expect(firstCandidates).toEqual(secondCandidates);
    expect(firstInvocationCount).toBeGreaterThan(0);
    expect(findRuleFilesRecursive).toHaveBeenCalledTimes(firstInvocationCount);
  });
});
