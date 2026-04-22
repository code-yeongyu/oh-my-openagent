import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { findRuleFilesRecursive } from "./rule-file-scanner";

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    if (existsSync(directory)) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("findRuleFilesRecursive", () => {
  test("returns rule files outside excluded nested directories", () => {
    // given
    const temporaryDirectory = join(tmpdir(), `perf-d01-${randomUUID()}`);
    createdDirectories.push(temporaryDirectory);

    const rulesDirectory = join(temporaryDirectory, ".sisyphus", "rules");
    mkdirSync(join(rulesDirectory, "node_modules", "fake"), { recursive: true });
    mkdirSync(join(rulesDirectory, ".git"), { recursive: true });
    writeFileSync(join(rulesDirectory, "foo.md"), "root rule");
    writeFileSync(
      join(rulesDirectory, "node_modules", "fake", "x.md"),
      "ignored node_modules rule",
    );
    writeFileSync(join(rulesDirectory, ".git", "x.md"), "ignored git rule");

    const results: string[] = [];

    // when
    findRuleFilesRecursive(rulesDirectory, results);

    // then
    expect(results).toEqual([join(rulesDirectory, "foo.md")]);
  });
});
