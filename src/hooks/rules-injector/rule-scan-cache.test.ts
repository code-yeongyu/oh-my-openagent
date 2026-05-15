import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createImportSuffix(): string {
  return `?test=${Date.now()}-${Math.random()}`;
}

describe("createRuleScanCache", () => {
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
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reuses cached directory scan results for identical inputs", async () => {
    // given
    const { createRuleScanCache } = await import(`./rule-scan-cache${createImportSuffix()}`);
    const { findRuleFiles } = await import(`./rule-file-finder${createImportSuffix()}`);
    const cache = createRuleScanCache();
    const secondRuleFile = join(expectedRuleDir, "python.instructions.md");

    mkdirSync(expectedRuleDir, { recursive: true });
    writeFileSync(expectedRuleFile, "TypeScript rules\n");

    // when
    const firstCandidates = findRuleFiles(projectRoot, homeDir, currentFile, undefined, cache);
    writeFileSync(secondRuleFile, "Python rules\n");
    const secondCandidates = findRuleFiles(projectRoot, homeDir, currentFile, undefined, cache);
    const uncachedCandidates = findRuleFiles(projectRoot, homeDir, currentFile);

    // then
    expect(firstCandidates.map((candidate) => candidate.path)).toEqual([expectedRuleFile]);
    expect(secondCandidates.map((candidate) => candidate.path)).toEqual([expectedRuleFile]);
    expect(uncachedCandidates.map((candidate) => candidate.path).sort()).toEqual([
      expectedRuleFile,
      secondRuleFile,
    ].sort());
  });
});
