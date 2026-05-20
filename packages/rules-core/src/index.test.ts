import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import {
  clearProjectRootCache,
  createAgentsMdCache,
  createRuleScanCache,
  findAgentsMdUp,
  findProjectRoot,
  findRuleFiles,
  parseRuleFrontmatter,
  shouldApplyRule,
} from "./index";
import * as logger from "../../../src/shared/logger";

let testRoot: string | null = null;

const SISYPHUS_DEPRECATION_MESSAGE = "[rules] .sisyphus/rules is deprecated and will be removed in v4.3.0; migrate to .omo/rules";

function createTestRoot(name: string): string {
  testRoot = join(tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(testRoot, { recursive: true });
  return testRoot;
}

afterEach(() => {
  mock.restore();
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true });
    testRoot = null;
  }
  clearProjectRootCache();
});

describe("rules-core", () => {
  it("#given mixed rule sources #when finding rule files #then returns deterministic source-priority order", () => {
    // given
    const root = createTestRoot("rules-core-order");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".omo", "rules"), { recursive: true });
    mkdirSync(join(root, ".sisyphus", "rules"), { recursive: true });
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
    mkdirSync(join(root, ".github", "instructions"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, ".github", "copilot-instructions.md"), "copilot");
    writeFileSync(join(root, ".omo", "rules", "omo.md"), "omo");
    writeFileSync(join(root, ".sisyphus", "rules", "sisyphus.md"), "sisyphus");
    writeFileSync(join(root, ".claude", "rules", "claude.md"), "claude");
    writeFileSync(join(root, ".cursor", "rules", "cursor.md"), "cursor");
    writeFileSync(join(root, ".github", "instructions", "github.instructions.md"), "github");

    // when
    const found = findRuleFiles(root, root, join(root, "src", "index.ts"));

    // then
    expect(found.map((rule) => rule.relativePath)).toEqual([
      ".github/copilot-instructions.md",
      ".omo/rules/omo.md",
      ".claude/rules/claude.md",
      ".cursor/rules/cursor.md",
      ".github/instructions/github.instructions.md",
      ".sisyphus/rules/sisyphus.md",
    ]);
  });

  it("#given a workspace with .sisyphus/rules/*.md #when findRuleFiles is called #then those files are discovered with lowest priority among project sources", () => {
    // given
    const root = createTestRoot("rules-core-sisyphus-restored");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".omo", "rules"), { recursive: true });
    mkdirSync(join(root, ".sisyphus", "rules"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, ".omo", "rules", "shared.md"), "omo");
    writeFileSync(join(root, ".sisyphus", "rules", "shared.md"), "legacy");
    writeFileSync(join(root, ".sisyphus", "rules", "legacy.md"), "legacy");

    // when
    const found = findRuleFiles(root, root, join(root, "src", "index.ts"));
    const relativePaths = found.map((rule) => rule.relativePath);
    const omoSharedIndex = relativePaths.indexOf(".omo/rules/shared.md");
    const sisyphusSharedIndex = relativePaths.indexOf(".sisyphus/rules/shared.md");

    // then
    expect(relativePaths).toContain(".sisyphus/rules/legacy.md");
    expect(omoSharedIndex).toBeGreaterThanOrEqual(0);
    expect(sisyphusSharedIndex).toBeGreaterThan(omoSharedIndex);
  });

  it("#given .sisyphus/rules is discovered #when the finder runs #then a deprecation warning is logged exactly once", () => {
    // given
    const root = createTestRoot("rules-core-sisyphus-warning");
    const legacyRulePath = join(root, ".sisyphus", "rules", "legacy.md");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".sisyphus", "rules"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(legacyRulePath, "legacy");
    const logSpy = spyOn(logger, "log").mockImplementation(() => {});

    // when
    findRuleFiles(root, root, join(root, "src", "index.ts"));
    findRuleFiles(root, root, join(root, "src", "index.ts"));
    const warnings = logSpy.mock.calls.filter(
      ([message, data]) => message === SISYPHUS_DEPRECATION_MESSAGE && isSisyphusDeprecationData(data, legacyRulePath),
    );

    // then
    expect(warnings).toHaveLength(1);
  });

  it("#given a workspace directory has no project marker (no .git, no package.json, etc.) AND contains .omo/rules/ #when findRuleFiles is called #then the .omo/rules/ files are still discovered", () => {
    // given
    const root = createTestRoot("rules-core-markerless-workspace");
    const homeDir = join(root, "home");
    const sourceDir = join(root, "src");
    const ruleFile = join(root, ".omo", "rules", "test-rule.md");
    const currentFile = join(sourceDir, "index.ts");
    mkdirSync(join(root, ".omo", "rules"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(ruleFile, "markerless workspace rule");
    writeFileSync(currentFile, "export {};");
    const projectRoot = findProjectRoot(currentFile);
    const options = { skipClaudeUserRules: false, workspaceDirectory: root };

    // when
    const found = findRuleFiles(projectRoot, homeDir, currentFile, options);

    // then
    expect(projectRoot).toBeNull();
    expect(found.map((rule) => rule.path)).toContain(ruleFile);
  });

  it("#given frontmatter aliases and negative glob #when matching #then honors applyTo paths and exclusions", () => {
    // given
    const { metadata } = parseRuleFrontmatter(`---\npaths: ["src/**/*.ts"]\napplyTo:\n  - "!src/**/*.test.ts"\n---\nRule\n`);

    // when
    const sourceMatch = shouldApplyRule(metadata, "/repo/src/index.ts", "/repo");
    const testMatch = shouldApplyRule(metadata, "/repo/src/index.test.ts", "/repo");

    // then
    expect(sourceMatch).toEqual({ applies: true, reason: "glob: src/**/*.ts" });
    expect(testMatch).toEqual({ applies: false });
  });

  it("#given nested AGENTS.md files #when walking up with root skip #then returns parent-to-child non-root files", async () => {
    // given
    const root = createTestRoot("rules-core-agents");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "packages", "app", "src"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "root");
    writeFileSync(join(root, "packages", "AGENTS.md"), "packages");
    writeFileSync(join(root, "packages", "app", "AGENTS.md"), "app");

    // when
    const found = await findAgentsMdUp({
      startDir: join(root, "packages", "app", "src"),
      rootDir: root,
      cache: createAgentsMdCache(),
    });

    // then
    expect(found).toEqual([
      join(root, "packages", "AGENTS.md"),
      join(root, "packages", "app", "AGENTS.md"),
    ]);
  });

  it("#given repeated same-directory targets #when using scan caches #then reuses cached candidates", () => {
    // given
    const root = createTestRoot("rules-core-cache");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".omo", "rules"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, ".omo", "rules", "typescript.md"), "typescript");
    const cache = createRuleScanCache();

    // when
    const first = findRuleFiles(root, root, join(root, "src", "a.ts"), undefined, cache);
    const second = findRuleFiles(root, root, join(root, "src", "b.ts"), undefined, cache);

    // then
    expect(first).toEqual(second);
    expect(cache.stats()).toEqual({ candidateEntries: 1, directoryEntries: 11 });
  });

  it("#given nested project markers #when finding project root #then memoizes ancestor lookups", () => {
    // given
    const root = createTestRoot("rules-core-project-root");
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });

    // when
    const first = findProjectRoot(join(root, "a", "b", "c", "file.ts"));
    const second = findProjectRoot(join(root, "a", "b", "other.ts"));

    // then
    expect(first).toBe(root);
    expect(second).toBe(root);
  });
});

function isSisyphusDeprecationData(data: unknown, path: string): boolean {
  if (typeof data !== "object" || data === null) return false;
  if (!("event" in data) || !("path" in data)) return false;
  return data.event === "rules-sisyphus-deprecated" && data.path === path;
}
