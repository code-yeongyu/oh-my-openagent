#!/usr/bin/env bun
/**
 * Flag test files for the junk classes a regex can see (the rest need a reader):
 *
 *   source-grep    - a value read from a source file (.ts/.js/.py/.rs/.go/...) is grepped
 *                    (toContain / toMatch / includes / `in`); byte equality between two reads is not flagged
 *   prose-pin      - a value read from a prompt/skill/markdown file has its wording pinned
 *                    (toContain / not.toContain / toMatch / toMatchSnapshot / `in`)
 *   fixed-sleep    - setTimeout-as-wait, sleep(N), time.sleep, thread::sleep, time.Sleep
 *   focused        - test.only / it.only / describe.only (a focused test silently skips the suite)
 *   skipped        - .skip / xit / xdescribe / @pytest.mark.skip / #[ignore] / t.Skip
 *   self-compare   - expect(x).toBe(x) / assert x == x / assert_eq!(x, x)
 *   lower-bound    - toBeGreaterThan(N>=1) / toBeGreaterThanOrEqual(N>=2) on a length/size/count
 *                    (removing one item stays green; a plain non-empty check is not flagged)
 *
 * Opt out per line with a trailing comment naming the rule and the reason:
 *   // test-junk-ok: fixed-sleep debounce window is the behavior under test
 *
 * Usage:
 *   bun run scripts/typescript/check-test-junk.ts [--json] <file-or-dir>...
 *
 * Exit codes: 0 no findings, 1 findings, 2 input error.
 * Each class is explained in references/testing/junk-classes.md; a finding here is a candidate
 * to prove with references/testing/README.md "test your test", not an automatic deletion.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join } from "node:path"
import process from "node:process"

import {
  collectReadVariables,
  greppedVariable,
  languageOf,
  LINE_RULES,
  READ_RULE_MESSAGES,
  RULE_IDS,
  SELF_COMPARE,
  type RuleId,
} from "./check-test-junk-rules"

export type { RuleId } from "./check-test-junk-rules"

export type Finding = {
  readonly file: string
  readonly line: number
  readonly rule: RuleId
  readonly message: string
}

const EXCLUDED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", "dist", "build", "target", "__pycache__", ".venv", "vendor"])

const TEST_FILE_PATTERNS: readonly RegExp[] = [
  /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/,
  /_test\.go$/,
  /(^|\/)test_[^/]*\.py$/,
  /(^|\/)[^/]*_test\.py$/,
  /\.rs$/,
]

const OPT_OUT = /test-junk-ok:\s*([a-z-]+)/

function isTestFile(file: string): boolean {
  if (!TEST_FILE_PATTERNS.some((pattern) => pattern.test(file))) return false
  // Rust unit tests live inside source files; only files declaring a test module count.
  return extname(file) !== ".rs" || /#\[cfg\(test\)\]|#\[test\]/.test(readFileSync(file, "utf8"))
}

function* walk(root: string): Generator<string> {
  if (statSync(root).isFile()) {
    yield root
    return
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) yield* walk(join(root, entry.name))
    } else if (entry.isFile()) {
      yield join(root, entry.name)
    }
  }
}

function optedOut(line: string, rule: RuleId): boolean {
  const match = OPT_OUT.exec(line)
  return match !== null && match[1] === rule
}

function scanFile(file: string): readonly Finding[] {
  const language = languageOf(file)
  if (language === undefined) return []
  const lines = readFileSync(file, "utf8").split("\n")
  const readVariables = collectReadVariables(lines, language)
  const findings: Finding[] = []
  const report = (line: number, rule: RuleId, message: string): void => {
    if (!optedOut(lines[line - 1] ?? "", rule)) findings.push({ file, line, rule, message })
  }

  lines.forEach((source, index) => {
    const line = index + 1
    for (const rule of LINE_RULES) {
      if (rule.languages.includes(language) && rule.pattern.test(source)) report(line, rule.rule, rule.message)
    }
    if (SELF_COMPARE[language].test(source)) {
      report(line, "self-compare", "the expected value is the value under test; derive it from the input")
    }
    const grepped = greppedVariable(source, language)
    const kind = grepped === undefined ? undefined : readVariables.get(grepped)
    if (kind !== undefined) report(line, READ_RULE_MESSAGES[kind].rule, READ_RULE_MESSAGES[kind].message)
  })
  return findings
}

function scan(paths: readonly string[]): readonly Finding[] {
  const findings: Finding[] = []
  for (const root of paths) {
    for (const file of walk(root)) {
      if (isTestFile(file)) findings.push(...scanFile(file))
    }
  }
  return findings
}

function main(argv: readonly string[]): number {
  const json = argv.includes("--json")
  const paths = argv.filter((arg) => arg !== "--json")
  if (paths.length === 0) {
    console.error(`usage: ${basename(import.meta.path)} [--json] <file-or-dir>...`)
    return 2
  }
  for (const path of paths) {
    try {
      statSync(path)
    } catch {
      console.error(`error: ${path} does not exist`)
      return 2
    }
  }
  const findings = scan(paths)
  if (json) {
    console.log(JSON.stringify({ findings, rules: RULE_IDS }, null, 2))
  } else {
    for (const finding of findings) console.log(`${finding.file}:${finding.line} ${finding.rule} ${finding.message}`)
    console.log(findings.length === 0 ? "check-test-junk: no findings" : `check-test-junk: ${findings.length} finding(s)`)
  }
  return findings.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
