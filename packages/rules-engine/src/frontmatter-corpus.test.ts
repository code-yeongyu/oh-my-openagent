import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { parseFrontmatter } from "@oh-my-opencode/utils";

import { parseRuleFrontmatter } from "./parser";
const corpusPaths = [
  ".agents/skills/opencode-qa/SKILL.md",
  ".agents/skills/security-research/SKILL.md",
  "packages/omo-opencode/src/features/builtin-skills/dev-browser/SKILL.md",
  "packages/omo-opencode/src/features/builtin-skills/git-master/SKILL.md",
  ".omo/rules/test-discipline.md",
] as const;

const syntheticRuleCorpus = [
  `---
applyTo: **/*.py
description: Python rules
---
Python body`,
  `---
paths: ["src/**/*.ts"]
applyTo:
  - "!src/**/*.test.ts"
alwaysApply: false
---
TypeScript body`,
  `---
globs: "*.md"
applyTo: "*.ts, *.js"
---
Mixed body`,
  `---
applyTo: [unterminated
---
Malformed body`,
] as const;

describe("rule frontmatter corpus", () => {
  it("#given real skill and rule files #when parsed #then rule metadata matches utils rule-mode frontmatter", () => {
    // given
    const contents = corpusPaths.map((relativePath) => readFileSync(join(process.cwd(), relativePath), "utf-8"));

    // when
    const parsed = contents.map((content) => ({
      rule: parseRuleFrontmatter(content),
      utils: parseFrontmatter(content, { mode: "rule" }),
    }));

    // then
    expect(parsed).toHaveLength(corpusPaths.length);
    for (const entry of parsed) {
      expect(entry.rule.metadata).toEqual(entry.utils.data);
      expect(entry.rule.body).toBe(entry.utils.body);
    }
  });

  it("#given legacy rule edge cases #when parsed #then utils rule mode preserves rule metadata shape", () => {
    // when
    const parsed = syntheticRuleCorpus.map((content) => ({
      rule: parseRuleFrontmatter(content),
      utils: parseFrontmatter(content, { mode: "rule" }),
    }));

    // then
    expect(parsed.map((entry) => entry.rule.metadata)).toEqual([
      { description: "Python rules", globs: "**/*.py" },
      { alwaysApply: false, globs: ["src/**/*.ts", "!src/**/*.test.ts"] },
      { globs: ["*.md", "*.ts", "*.js"] },
      { globs: [] },
    ]);
    expect(parsed.map((entry) => entry.utils.data)).toEqual(parsed.map((entry) => entry.rule.metadata));
  });
});
