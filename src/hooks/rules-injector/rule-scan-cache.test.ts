import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
    const value = [
      { path: "/tmp/a.md", realPath: "/tmp/a.md", isGlobal: false, distance: 0 },
      { path: "/tmp/b.md", realPath: "/tmp/b.md", isGlobal: false, distance: 1 },
    ];

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

  it("does not re-resolve symlinked rule path on cache hit", async () => {
    // given
    const { createRuleScanCache } = await import(`./rule-scan-cache${createImportSuffix()}`);
    const { findRuleFiles } = await import(`./rule-file-finder${createImportSuffix()}`);
    const actualGithubA = join(projectRoot, "actual-github-a");
    const actualGithubB = join(projectRoot, "actual-github-b");
    const instructionsBaseA = join(actualGithubA, "instructions");
    const instructionsBaseB = join(actualGithubB, "instructions");
    const ruleFileA = join(instructionsBaseA, "typescript.instructions.md");
    const ruleFileB = join(instructionsBaseB, "typescript.instructions.md");
    const symlinkGithub = join(projectRoot, ".github");
    mkdirSync(instructionsBaseA, { recursive: true });
    mkdirSync(instructionsBaseB, { recursive: true });
    writeFileSync(ruleFileA, "alpha rules\n");
    writeFileSync(ruleFileB, "beta rules\n");
    symlinkSync(actualGithubA, symlinkGithub, "dir");
    const canonicalRuleFileA = realpathSync(ruleFileA);
    const cache = createRuleScanCache();

    // when
    const firstCandidates = findRuleFiles(projectRoot, homeDir, currentFile, undefined, cache);
    const cachedRealPath = firstCandidates[0]?.realPath;
    unlinkSync(symlinkGithub);
    symlinkSync(actualGithubB, symlinkGithub, "dir");
    const secondCandidates = findRuleFiles(projectRoot, homeDir, currentFile, undefined, cache);
    const reusedRealPath = secondCandidates[0]?.realPath;

    // then
    expect(cachedRealPath).toBe(canonicalRuleFileA);
    expect(reusedRealPath).toBe(canonicalRuleFileA);
  });

  it("reuses ancestor directory scan for sibling files in the same project", async () => {
    // given
    const { createRuleScanCache } = await import(`./rule-scan-cache${createImportSuffix()}`);
    const { findRuleFiles } = await import(`./rule-file-finder${createImportSuffix()}`);
    const siblingDirA = join(projectRoot, "src", "alpha");
    const siblingDirB = join(projectRoot, "src", "beta");
    const siblingFileA = join(siblingDirA, "a.ts");
    const siblingFileB = join(siblingDirB, "b.ts");
    mkdirSync(siblingDirA, { recursive: true });
    mkdirSync(siblingDirB, { recursive: true });
    writeFileSync(siblingFileA, "export const a = 1;\n");
    writeFileSync(siblingFileB, "export const b = 2;\n");
    mkdirSync(expectedRuleDir, { recursive: true });
    writeFileSync(expectedRuleFile, "shared ancestor rules\n");
    const cache = createRuleScanCache();

    // when
    const firstCandidates = findRuleFiles(projectRoot, homeDir, siblingFileA, undefined, cache);
    unlinkSync(expectedRuleFile);
    rmSync(expectedRuleDir, { recursive: true, force: true });
    const siblingCandidates = findRuleFiles(projectRoot, homeDir, siblingFileB, undefined, cache);

    // then
    expect(firstCandidates.map((candidate) => candidate.path)).toEqual([
      expectedRuleFile,
    ]);
    expect(siblingCandidates.map((candidate) => candidate.path)).toEqual([
      expectedRuleFile,
    ]);
  });
});
