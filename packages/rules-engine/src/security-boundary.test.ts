/// <reference path="../../../bun-test.d.ts" />

import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { clearProjectRootCache, findRuleFiles } from "./index";
import { _resetSisyphusRuleDeprecationWarningStateForTesting } from "./finder";

let testRoot: string | null = null;

function createTestRoot(name: string): string {
  testRoot = join(tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(testRoot, { recursive: true });
  return testRoot;
}

afterEach(() => {
  _resetSisyphusRuleDeprecationWarningStateForTesting();
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true });
    testRoot = null;
  }
  clearProjectRootCache();
});

describe("rules-core security boundary", () => {
  it("#given a project .omo/rules directory symlink escapes the workspace #when finding rule files #then escaped rules are rejected", () => {
    // given
    const root = createTestRoot("rules-core-project-dir-symlink-escape");
    const projectRoot = join(root, "repo");
    const homeDir = join(root, "home");
    const outsideDir = join(root, "outside-rules");
    const currentFile = join(projectRoot, "src", "index.ts");
    const escapedRule = join(outsideDir, "leak.md");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, ".git"));
    mkdirSync(join(projectRoot, ".omo"), { recursive: true });
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(currentFile, "export {};");
    writeFileSync(escapedRule, "do not inject this external project rule");
    symlinkSync(outsideDir, join(projectRoot, ".omo", "rules"), "dir");

    // when
    const found = findRuleFiles(projectRoot, homeDir, currentFile);

    // then
    expect(found.some((rule) => rule.realPath === realpathSync.native(escapedRule))).toBe(false);
  });

  it("#given a project .github/instructions directory symlink escapes the workspace #when finding rule files #then escaped instructions are rejected", () => {
    // given
    const root = createTestRoot("rules-core-github-dir-symlink-escape");
    const projectRoot = join(root, "repo");
    const homeDir = join(root, "home");
    const outsideDir = join(root, "outside-instructions");
    const currentFile = join(projectRoot, "src", "index.ts");
    const escapedInstruction = join(outsideDir, "leak.instructions.md");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, ".git"));
    mkdirSync(join(projectRoot, ".github"), { recursive: true });
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(currentFile, "export {};");
    writeFileSync(escapedInstruction, "do not inject this external github instruction");
    symlinkSync(outsideDir, join(projectRoot, ".github", "instructions"), "dir");

    // when
    const found = findRuleFiles(projectRoot, homeDir, currentFile);

    // then
    expect(found.some((rule) => rule.realPath === realpathSync.native(escapedInstruction))).toBe(false);
  });
});
