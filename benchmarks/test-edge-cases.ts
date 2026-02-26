#!/usr/bin/env bun
/**
 * Comprehensive headless edit_file stress test: 25 edge cases
 *
 * Tests: 5 basic ops + 14 creative cases + 6 whitespace cases
 * Each runs via headless mode with its own demo file + prompt.
 *
 * Usage:
 *   bun run scripts/test-headless-edit-edge-cases.ts [-m <model>] [--provider <provider>]
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── CLI arg passthrough ───────────────────────────────────────
const extraArgs: string[] = [];
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (
    (arg === "-m" || arg === "--model" || arg === "--provider") &&
    i + 1 < rawArgs.length
  ) {
    extraArgs.push(arg, rawArgs[i + 1]);
    i++;
  } else if (arg === "--think" || arg === "--no-translate") {
    extraArgs.push(arg);
  } else if (arg === "--reasoning-mode" && i + 1 < rawArgs.length) {
    extraArgs.push(arg, rawArgs[i + 1]);
    i++;
  }
}

// ── Colors ────────────────────────────────────────────────────
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const pass = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`);
const info = (msg: string) => console.log(`  ${DIM}${msg}${RESET}`);
const warn = (msg: string) => console.log(`  ${YELLOW}⚠${RESET} ${msg}`);

// ── Test case definition ─────────────────────────────────────
interface TestCase {
  fileContent: string;
  fileName: string;
  name: string;
  prompt: string;
  validate: (content: string) => { passed: boolean; reason: string };
}

const TEST_CASES: TestCase[] = [
  {
    name: "1. Single-line file — replace only line",
    fileName: "single-line.txt",
    fileContent: "only_line_original",
    prompt: [
      "Read single-line.txt with read_file.",
      "Replace the only line using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['only_line_updated'] }].",
      "Expected final content exactly one line: only_line_updated.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "").trimEnd();
      const lines = normalized.split("\n");
      if (lines.length === 1 && lines[0] === "only_line_updated") {
        return { passed: true, reason: "single line replaced correctly" };
      }
      if (normalized.includes("only_line_original")) {
        return { passed: false, reason: "original line still present" };
      }
      return {
        passed: false,
        reason: `expected one line 'only_line_updated', got ${lines.length} lines`,
      };
    },
  },
  {
    name: "2. Large file (20 lines) — replace middle line 11",
    fileName: "twenty-lines.txt",
    fileContent: Array.from(
      { length: 20 },
      (_, i) => `line${String(i + 1).padStart(2, "0")}: value-${i + 1}`
    ).join("\n"),
    prompt: [
      "Read twenty-lines.txt with read_file.",
      "Replace line 11 using edit_file with edits: [{ op: 'replace', pos: '<line11 anchor>', lines: ['line11: UPDATED-MIDDLE'] }].",
      "Keep all other lines unchanged.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines.length !== 20) {
        return {
          passed: false,
          reason: `expected 20 lines, got ${lines.length}`,
        };
      }
      if (lines[10] !== "line11: UPDATED-MIDDLE") {
        return {
          passed: false,
          reason: `line 11 mismatch: '${lines[10] ?? "<missing>"}'`,
        };
      }
      if (lines[9] !== "line10: value-10" || lines[11] !== "line12: value-12") {
        return {
          passed: false,
          reason: "neighboring lines changed unexpectedly",
        };
      }
      return {
        passed: true,
        reason: "line 11 replaced and surrounding lines preserved",
      };
    },
  },
  {
    name: "3. Range replace entire file (first→last to one line)",
    fileName: "range-all.txt",
    fileContent: ["first", "second", "third", "fourth", "fifth"].join("\n"),
    prompt: [
      "Read range-all.txt with read_file.",
      "Replace the full file from first line to last line using one range edit: edits: [{ op: 'replace', pos: '<line1 anchor>', end: '<line5 anchor>', lines: ['collapsed-to-one-line'] }].",
      "Expected final content exactly: collapsed-to-one-line.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "").trimEnd();
      if (normalized === "collapsed-to-one-line") {
        return {
          passed: true,
          reason: "entire file collapsed to single replacement line",
        };
      }
      if (normalized.includes("first") || normalized.includes("fifth")) {
        return {
          passed: false,
          reason: "original range content still present",
        };
      }
      return {
        passed: false,
        reason: `unexpected final content: '${normalized.slice(0, 120)}'`,
      };
    },
  },
  {
    name: "4. Mixed ops in one call (replace + append + prepend)",
    fileName: "mixed-one-call.txt",
    fileContent: ["alpha", "beta", "gamma"].join("\n"),
    prompt: [
      "Read mixed-one-call.txt with read_file.",
      "Call edit_file exactly once with three edits in one edits array:",
      "edits: [",
      "{ op: 'replace', pos: '<line2 anchor>', lines: ['BETA'] },",
      "{ op: 'append', pos: '<line3 anchor>', lines: ['delta'] },",
      "{ op: 'prepend', pos: '<line1 anchor>', lines: ['start'] }",
      "].",
      "Expected final content: start, alpha, BETA, gamma, delta.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      const expected = ["start", "alpha", "BETA", "gamma", "delta"];
      if (lines.length !== expected.length) {
        return {
          passed: false,
          reason: `expected ${expected.length} lines, got ${lines.length}`,
        };
      }
      for (let i = 0; i < expected.length; i++) {
        if (lines[i] !== expected[i]) {
          return {
            passed: false,
            reason: `line ${i + 1} expected '${expected[i]}' but got '${lines[i]}'`,
          };
        }
      }
      return {
        passed: true,
        reason: "single call applied replace, append, and prepend",
      };
    },
  },
  {
    name: "5. Large batch (5 replaces) in one call",
    fileName: "batch-five.txt",
    fileContent: [
      "row-1",
      "row-2",
      "row-3",
      "row-4",
      "row-5",
      "row-6",
      "row-7",
      "row-8",
      "row-9",
      "row-10",
    ].join("\n"),
    prompt: [
      "Read batch-five.txt with read_file.",
      "Call edit_file once with five replace edits in one edits array:",
      "edits: [",
      "{ op: 'replace', pos: '<line1 anchor>', lines: ['ROW-1'] },",
      "{ op: 'replace', pos: '<line3 anchor>', lines: ['ROW-3'] },",
      "{ op: 'replace', pos: '<line5 anchor>', lines: ['ROW-5'] },",
      "{ op: 'replace', pos: '<line7 anchor>', lines: ['ROW-7'] },",
      "{ op: 'replace', pos: '<line10 anchor>', lines: ['ROW-10'] }",
      "].",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines.length !== 10) {
        return {
          passed: false,
          reason: `expected 10 lines, got ${lines.length}`,
        };
      }
      const checks: [number, string][] = [
        [0, "ROW-1"],
        [2, "ROW-3"],
        [4, "ROW-5"],
        [6, "ROW-7"],
        [9, "ROW-10"],
      ];
      for (const [idx, expected] of checks) {
        if (lines[idx] !== expected) {
          return {
            passed: false,
            reason: `line ${idx + 1} expected '${expected}' but got '${lines[idx]}'`,
          };
        }
      }
      if (
        lines[1] !== "row-2" ||
        lines[3] !== "row-4" ||
        lines[8] !== "row-9"
      ) {
        return {
          passed: false,
          reason: "unchanged lines were unexpectedly modified",
        };
      }
      return {
        passed: true,
        reason: "all 5 replacements succeeded in one edit_file call",
      };
    },
  },
  {
    name: "6. Consecutive edits (read→edit→read→edit)",
    fileName: "consecutive.txt",
    fileContent: ["stage: one", "value: 1", "status: draft"].join("\n"),
    prompt: [
      "Read consecutive.txt with read_file.",
      "First call edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['value: 2'] }].",
      "Then read consecutive.txt with read_file again.",
      "Second, call edit_file again with edits: [{ op: 'replace', pos: '<line3 anchor>', lines: ['status: final'] }].",
      "Expected final content: stage: one, value: 2, status: final.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      const expected = ["stage: one", "value: 2", "status: final"];
      if (lines.length !== expected.length) {
        return {
          passed: false,
          reason: `expected ${expected.length} lines, got ${lines.length}`,
        };
      }
      for (let i = 0; i < expected.length; i++) {
        if (lines[i] !== expected[i]) {
          return {
            passed: false,
            reason: `line ${i + 1} expected '${expected[i]}' but got '${lines[i]}'`,
          };
        }
      }
      return {
        passed: true,
        reason: "two sequential edit_file calls produced expected final state",
      };
    },
  },
  {
    name: "7. Create new file via append",
    fileName: "create-via-append.txt",
    fileContent: "",
    prompt: [
      "Create create-via-append.txt via edit_file append (do not call read_file first).",
      "Use one call with edits: [{ op: 'append', lines: ['created line 1', 'created line 2'] }].",
      "Expected final content exactly two lines: created line 1 and created line 2.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "").trimEnd();
      const lines = normalized === "" ? [] : normalized.split("\n");
      if (lines.length !== 2) {
        return {
          passed: false,
          reason: `expected 2 lines, got ${lines.length}`,
        };
      }
      if (lines[0] !== "created line 1" || lines[1] !== "created line 2") {
        return {
          passed: false,
          reason: `unexpected file content: '${normalized.slice(0, 120)}'`,
        };
      }
      return {
        passed: true,
        reason: "append created expected two-line content",
      };
    },
  },
  {
    name: "8. Unicode/emoji line replacement",
    fileName: "unicode.txt",
    fileContent: ["status: pending", "message: old"].join("\n"),
    prompt: [
      "Read unicode.txt with read_file.",
      "Replace line 2 with Unicode content using edit_file and edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['message: 🎉🚀 한국어 테스트 완료'] }].",
      "Expected line 2 exactly: message: 🎉🚀 한국어 테스트 완료.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[1] !== "message: 🎉🚀 한국어 테스트 완료") {
        return {
          passed: false,
          reason: `line 2 mismatch: '${lines[1] ?? "<missing>"}'`,
        };
      }
      if (content.includes("message: old")) {
        return { passed: false, reason: "old message still present" };
      }
      return {
        passed: true,
        reason: "Unicode and emoji content replaced correctly",
      };
    },
  },
  {
    name: "9. Backticks/template literal content",
    fileName: "template.ts",
    fileContent: ["const name = 'dev';", "const msg = 'old';"].join("\n"),
    prompt: [
      "Read template.ts with read_file.",
      "Replace line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['const msg = `hello \u0024{name}`;'] }].",
      "Expected line 2 exactly: const msg = `hello \u0024{name}`;",
    ].join(" "),
    validate: (content) => {
      const expected = "const msg = `hello \u0024{name}`;";
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[1] !== expected) {
        return {
          passed: false,
          reason: `line 2 expected '${expected}' but got '${lines[1] ?? "<missing>"}'`,
        };
      }
      if (content.includes("const msg = 'old';")) {
        return { passed: false, reason: "old msg assignment still present" };
      }
      return {
        passed: true,
        reason: "template literal with backticks preserved",
      };
    },
  },
  {
    name: "10. Regex pattern content",
    fileName: "regex.ts",
    fileContent: ["const re = /old/;", "const ok = true;"].join("\n"),
    prompt: [
      "Read regex.ts with read_file.",
      "Replace line 1 using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['const re = /^[a-z]+\\d{2,}$/gi;'] }].",
      "Expected line 1 exactly: const re = /^[a-z]+\\d{2,}$/gi;",
    ].join(" "),
    validate: (content) => {
      const expected = "const re = /^[a-z]+\\d{2,}$/gi;";
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[0] !== expected) {
        return {
          passed: false,
          reason: `regex line mismatch: '${lines[0] ?? "<missing>"}'`,
        };
      }
      if (content.includes("const re = /old/;")) {
        return { passed: false, reason: "old regex still present" };
      }
      return {
        passed: true,
        reason: "regex pattern replacement preserved escaping",
      };
    },
  },
  {
    name: "11. Escaped quotes and backslashes",
    fileName: "path.cfg",
    fileContent: ['path = "/tmp/file.txt"', "mode = rw"].join("\n"),
    prompt: [
      "Read path.cfg with read_file.",
      "Replace line 1 using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['path = \"C:\\\\Users\\\\admin\\\\file.txt\"'] }].",
      'The file should contain a Windows-style path with backslashes: C:\\Users\\admin\\file.txt.',
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      const line1 = lines[0] ?? "";
      // Accept either single or double backslashes — both are valid model interpretations
      const hasSingleBS = line1.includes('C:\\Users\\admin\\file.txt');
      const hasDoubleBS = line1.includes('C:\\\\Users\\\\admin\\\\file.txt');
      const hasPath = hasSingleBS || hasDoubleBS;
      const hasQuotes = line1.includes('"');
      if (hasPath && hasQuotes) {
        return {
          passed: true,
          reason: "backslash path content preserved correctly",
        };
      }
      return {
        passed: false,
        reason: `expected Windows path with backslashes but got '${line1}'`,
      };
    },
  },
  {
    name: "12. HTML tags in content",
    fileName: "html-snippet.txt",
    fileContent: ["snippet: old", "done: true"].join("\n"),
    prompt: [
      "Read html-snippet.txt with read_file.",
      "Replace line 1 using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['<div class=\"container\"><p>Hello</p></div>'] }].",
      'Expected line 1 exactly: <div class="container"><p>Hello</p></div>.',
    ].join(" "),
    validate: (content) => {
      const expected = '<div class="container"><p>Hello</p></div>';
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[0] !== expected) {
        return {
          passed: false,
          reason: `HTML line mismatch: '${lines[0] ?? "<missing>"}'`,
        };
      }
      if (content.includes("snippet: old")) {
        return { passed: false, reason: "old snippet line still present" };
      }
      return { passed: true, reason: "HTML tag content inserted exactly" };
    },
  },
  {
    name: "13. Very long line (180 chars)",
    fileName: "long-line.txt",
    fileContent: ["line-1", "short-line"].join("\n"),
    prompt: [
      "Read long-line.txt with read_file.",
      `Replace line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['${"L".repeat(180)}'] }].`,
      "Expected line 2 to be exactly 180 characters.",
    ].join(" "),
    validate: (content) => {
      const expected = "L".repeat(180);
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (!lines[1]) {
        return { passed: false, reason: "line 2 is missing" };
      }
      if (Math.abs(lines[1].length - 180) > 2) {
        return {
          passed: false,
          reason: `line 2 length expected ~180 but got ${lines[1].length}`,
        };
      }
      if (!lines[1].startsWith("LLLL")) {
        return {
          passed: false,
          reason: "line 2 content does not match expected repeated-L string",
        };
      }
      return { passed: true, reason: `long line replaced (${lines[1].length} chars)` };
    },
  },
  {
    name: "14. SQL query content",
    fileName: "sql-content.txt",
    fileContent: ["SELECT 1;", "done"].join("\n"),
    prompt: [
      "Read sql-content.txt with read_file.",
      "Replace line 1 using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.total > 100;'] }].",
      "Expected line 1 exactly the provided SQL query.",
    ].join(" "),
    validate: (content) => {
      const expected =
        "SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.total > 100;";
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[0] !== expected) {
        return {
          passed: false,
          reason: `SQL line mismatch: '${lines[0] ?? "<missing>"}'`,
        };
      }
      return { passed: true, reason: "SQL query line replaced exactly" };
    },
  },
  {
    name: "15. Mixed indentation (tab -> spaces)",
    fileName: "mixed-indent.ts",
    fileContent: [
      "function run() {",
      "\tconst tabIndented = true;",
      "  const twoSpaces = true;",
      "}",
    ].join("\n"),
    prompt: [
      "Read mixed-indent.ts with read_file.",
      "Replace the tab-indented line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['    const tabIndented = true;'] }].",
      "Expected line 2 to be 4 spaces + const tabIndented = true;",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "");
      const lines = normalized.endsWith("\n")
        ? normalized.slice(0, -1).split("\n")
        : normalized.split("\n");
      if (lines[1] !== "    const tabIndented = true;") {
        return {
          passed: false,
          reason: `line 2 mismatch: '${lines[1] ?? "<missing>"}'`,
        };
      }
      if (lines[1].includes("\t")) {
        return {
          passed: false,
          reason: "line 2 still contains a tab character",
        };
      }
      if (lines[2] !== "  const twoSpaces = true;") {
        return { passed: false, reason: "line 3 changed unexpectedly" };
      }
      return {
        passed: true,
        reason: "tab-indented line replaced with space-indented line",
      };
    },
  },
  {
    name: "16. Trailing whitespace preservation",
    fileName: "trailing-whitespace.txt",
    fileContent: ["start", "text   ", "end"].join("\n"),
    prompt: [
      "Read trailing-whitespace.txt with read_file.",
      "Replace line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['new_text   '] }].",
      "Keep exactly three trailing spaces after new_text.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "");
      const lines = normalized.endsWith("\n")
        ? normalized.slice(0, -1).split("\n")
        : normalized.split("\n");
      if (!lines[1]) {
        return { passed: false, reason: "line 2 missing" };
      }
      if (lines[1] === "new_text   ") {
        return {
          passed: true,
          reason: "trailing spaces preserved on replaced line",
        };
      }
      if (lines[1] === "new_text") {
        return { passed: false, reason: "trailing spaces were stripped" };
      }
      return {
        passed: false,
        reason: `line 2 unexpected value: ${JSON.stringify(lines[1])}`,
      };
    },
  },
  {
    name: "17. Replace line containing only spaces",
    fileName: "spaces-only-line.txt",
    fileContent: ["alpha", "    ", "omega"].join("\n"),
    prompt: [
      "Read spaces-only-line.txt with read_file.",
      "Replace the line that contains only 4 spaces (line 2) using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['middle-content'] }].",
      "Expected final content: alpha, middle-content, omega.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "");
      const lines = normalized.endsWith("\n")
        ? normalized.slice(0, -1).split("\n")
        : normalized.split("\n");
      if (lines.length !== 3) {
        return {
          passed: false,
          reason: `expected 3 lines, got ${lines.length}`,
        };
      }
      if (lines[0] !== "alpha" || lines[2] !== "omega") {
        return {
          passed: false,
          reason: "non-target lines changed unexpectedly",
        };
      }
      if (lines[1].trim() !== "middle-content") {
        return {
          passed: false,
          reason: `line 2 expected 'middle-content' but got ${JSON.stringify(lines[1])}`,
        };
      }
      return {
        passed: true,
        reason: "4-space-only line replaced with content",
      };
    },
  },
  {
    name: "18. Delete middle blank from consecutive blank lines",
    fileName: "consecutive-blanks.txt",
    fileContent: ["top", "", "", "", "bottom"].join("\n"),
    prompt: [
      "Read consecutive-blanks.txt with read_file.",
      "Delete only the middle blank line (line 3 of 5) using edit_file with edits: [{ op: 'replace', pos: '<line3 anchor>', lines: [] }].",
      "Keep the other two blank lines intact.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "");
      const lines = normalized.endsWith("\n")
        ? normalized.slice(0, -1).split("\n")
        : normalized.split("\n");
      const expected = ["top", "", "", "bottom"];
      if (lines.length !== expected.length) {
        return {
          passed: false,
          reason: `expected ${expected.length} lines after deleting one blank, got ${lines.length}`,
        };
      }
      for (let i = 0; i < expected.length; i++) {
        if (lines[i] !== expected[i]) {
          return {
            passed: false,
            reason: `line ${i + 1} expected ${JSON.stringify(expected[i])} but got ${JSON.stringify(lines[i])}`,
          };
        }
      }
      return { passed: true, reason: "only the middle blank line was deleted" };
    },
  },
  {
    name: "19. Indentation increase (2 spaces -> 8 spaces)",
    fileName: "indent-increase.js",
    fileContent: ["if (flag) {", "  execute();", "}"].join("\n"),
    prompt: [
      "Read indent-increase.js with read_file.",
      "Replace line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['        execute();'] }].",
      "Expected line 2 indentation increased from 2 spaces to 8 spaces.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "");
      const lines = normalized.endsWith("\n")
        ? normalized.slice(0, -1).split("\n")
        : normalized.split("\n");
      if (lines.length !== 3) {
        return {
          passed: false,
          reason: `expected 3 lines, got ${lines.length}`,
        };
      }
      if (lines[1] !== "        execute();") {
        return {
          passed: false,
          reason: `line 2 expected 8-space indentation, got ${JSON.stringify(lines[1])}`,
        };
      }
      if (lines[0] !== "if (flag) {" || lines[2] !== "}") {
        return { passed: false, reason: "outer lines changed unexpectedly" };
      }
      return {
        passed: true,
        reason: "indentation increased to 8 spaces as expected",
      };
    },
  },
  {
    name: "20. Content that resembles hashline format",
    fileName: "hashline-content.txt",
    fileContent: ["anchor: old", "tail"].join("\n"),
    prompt: [
      "Read hashline-content.txt with read_file.",
      "Replace line 1 using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['anchor: 1#AB format is used'] }].",
      "Expected line 1 exactly: anchor: 1#AB format is used.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[0] !== "anchor: 1#AB format is used") {
        return {
          passed: false,
          reason: `line 1 mismatch: '${lines[0] ?? "<missing>"}'`,
        };
      }
      return {
        passed: true,
        reason: "hashline-like literal content preserved correctly",
      };
    },
  },
  {
    name: "21. Literal backslash-n content",
    fileName: "literal-backslash-n.txt",
    fileContent: ["placeholder", "tail"].join("\n"),
    prompt: [
      "Read literal-backslash-n.txt with read_file.",
      "Replace line 1 using edit_file with edits: [{ op: 'replace', pos: '<line1 anchor>', lines: ['line1\\nline2 (literal backslash-n, not newline)'] }].",
      "Expected first line to contain literal \\n characters, not an actual newline split.",
    ].join(" "),
    validate: (content) => {
      const expected = "line1\\nline2 (literal backslash-n, not newline)";
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines.length !== 2) {
        return {
          passed: false,
          reason: `expected 2 lines total, got ${lines.length}`,
        };
      }
      if (lines[0] !== expected) {
        return {
          passed: false,
          reason: `line 1 expected '${expected}' but got '${lines[0] ?? "<missing>"}'`,
        };
      }
      return {
        passed: true,
        reason: "literal \\n sequence preserved in a single line",
      };
    },
  },
  {
    name: "22. Append multiple lines at once",
    fileName: "append-multi.txt",
    fileContent: ["header", "anchor-line", "footer"].join("\n"),
    prompt: [
      "Read append-multi.txt with read_file.",
      "Append three lines after anchor-line (line 2) using edit_file with edits: [{ op: 'append', pos: '<line2 anchor>', lines: ['item-a', 'item-b', 'item-c'] }].",
      "Expected final order: header, anchor-line, item-a, item-b, item-c, footer.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      const expected = [
        "header",
        "anchor-line",
        "item-a",
        "item-b",
        "item-c",
        "footer",
      ];
      if (lines.length !== expected.length) {
        return {
          passed: false,
          reason: `expected ${expected.length} lines, got ${lines.length}`,
        };
      }
      for (let i = 0; i < expected.length; i++) {
        if (lines[i] !== expected[i]) {
          return {
            passed: false,
            reason: `line ${i + 1} expected '${expected[i]}' but got '${lines[i]}'`,
          };
        }
      }
      return {
        passed: true,
        reason: "three lines appended in a single append edit",
      };
    },
  },
  {
    name: "23. Replace long line with single short word",
    fileName: "shrink-line.txt",
    fileContent: [
      "prefix",
      "this line is intentionally very long so that replacing it with one short token verifies a major length reduction edge case",
      "suffix",
    ].join("\n"),
    prompt: [
      "Read shrink-line.txt with read_file.",
      "Replace the long line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['short'] }].",
      "Expected final line 2 exactly: short.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      if (lines[1] !== "short") {
        return {
          passed: false,
          reason: `line 2 expected 'short' but got '${lines[1] ?? "<missing>"}'`,
        };
      }
      if (content.includes("intentionally very long")) {
        return { passed: false, reason: "old long line text still present" };
      }
      return {
        passed: true,
        reason: "long line replaced by single short word",
      };
    },
  },
  {
    name: "24. Edit file with no trailing newline",
    fileName: "no-trailing-newline.txt",
    fileContent: "first\nsecond\nthird",
    prompt: [
      "Read no-trailing-newline.txt with read_file.",
      "Replace line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['SECOND'] }].",
      "Expected final content lines: first, SECOND, third, and no trailing newline at EOF.",
    ].join(" "),
    validate: (content) => {
      const normalized = content.replace(/\r/g, "");
      const lines = normalized.split("\n");
      if (lines.length !== 3) {
        return {
          passed: false,
          reason: `expected 3 lines, got ${lines.length}`,
        };
      }
      if (
        lines[0] !== "first" ||
        lines[1] !== "SECOND" ||
        lines[2] !== "third"
      ) {
        return {
          passed: false,
          reason: `unexpected lines: ${JSON.stringify(lines)}`,
        };
      }
      if (normalized.endsWith("\n")) {
        return {
          passed: false,
          reason: "file now has trailing newline but should not",
        };
      }
      return {
        passed: true,
        reason: "edited correctly without introducing trailing newline",
      };
    },
  },
  {
    name: "25. Prepend at BOF without pos anchor",
    fileName: "prepend-bof.js",
    fileContent: ["console.log('hello');", "console.log('done');"].join("\n"),
    prompt: [
      "Read prepend-bof.js with read_file.",
      "Prepend a shebang at beginning of file using edit_file with no pos: edits: [{ op: 'prepend', lines: ['#!/usr/bin/env node'] }].",
      "Do not include a pos field. Expected first line: #!/usr/bin/env node.",
    ].join(" "),
    validate: (content) => {
      const lines = content.replace(/\r/g, "").trimEnd().split("\n");
      const expected = [
        "#!/usr/bin/env node",
        "console.log('hello');",
        "console.log('done');",
      ];
      if (lines.length !== expected.length) {
        return {
          passed: false,
          reason: `expected ${expected.length} lines, got ${lines.length}`,
        };
      }
      for (let i = 0; i < expected.length; i++) {
        if (lines[i] !== expected[i]) {
          return {
            passed: false,
            reason: `line ${i + 1} expected '${expected[i]}' but got '${lines[i]}'`,
          };
        }
      }
      return {
        passed: true,
        reason: "shebang prepended at BOF without pos anchor",
      };
    },
  },
];

// ── JSONL event types ─────────────────────────────────────────
interface ToolCallEvent {
  tool_call_id: string;
  tool_input: Record<string, unknown>;
  tool_name: string;
  type: "tool_call";
}

interface ToolResultEvent {
  error?: string;
  output: string;
  tool_call_id: string;
  type: "tool_result";
}

interface AnyEvent {
  type: string;
  [key: string]: unknown;
}

// ── Run single test case ─────────────────────────────────────
async function runTestCase(
  tc: TestCase,
  testDir: string
): Promise<{
  passed: boolean;
  editCalls: number;
  editSuccesses: number;
  duration: number;
}> {
  const testFile = join(testDir, tc.fileName);
  writeFileSync(testFile, tc.fileContent, "utf-8");

  const headlessScript = resolve(import.meta.dir, "headless.ts");
  const headlessArgs = [
    "run",
    headlessScript,
    "-p",
    tc.prompt,
    "--no-translate",
    ...extraArgs,
  ];

  const startTime = Date.now();

  const output = await new Promise<string>((res, reject) => {
    const proc = spawn("bun", headlessArgs, {
      cwd: testDir,
      env: { ...process.env, BUN_INSTALL: process.env.BUN_INSTALL },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(
      () => {
        proc.kill("SIGTERM");
        reject(new Error("Timed out after 4 minutes"));
      },
      4 * 60 * 1000
    );

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Exit code ${code}\n${stderr.slice(-500)}`));
      } else {
        res(stdout);
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const duration = Date.now() - startTime;

  // Parse events
  const events: AnyEvent[] = [];
  for (const line of output.split("\n").filter((l) => l.trim())) {
    try {
      events.push(JSON.parse(line) as AnyEvent);
    } catch {
      // skip non-JSON
    }
  }

  const toolCalls = events.filter(
    (e) => e.type === "tool_call"
  ) as unknown as ToolCallEvent[];
  const toolResults = events.filter(
    (e) => e.type === "tool_result"
  ) as unknown as ToolResultEvent[];

  const editCalls = toolCalls.filter((e) => e.tool_name === "edit_file");
  const editCallIds = new Set(editCalls.map((e) => e.tool_call_id));
  const editResults = toolResults.filter((e) =>
    editCallIds.has(e.tool_call_id)
  );
  const editSuccesses = editResults.filter((e) => !e.error);

  // Show blocked calls
  const editErrors = editResults.filter((e) => e.error);
  for (const err of editErrors) {
    const matchingCall = editCalls.find(
      (c) => c.tool_call_id === err.tool_call_id
    );
    info(`  blocked: ${err.error?.slice(0, 120)}`);
    if (matchingCall) {
      info(`  input: ${JSON.stringify(matchingCall.tool_input).slice(0, 200)}`);
    }
  }

  // Validate file content
  let finalContent: string;
  try {
    finalContent = readFileSync(testFile, "utf-8");
  } catch {
    return {
      passed: false,
      editCalls: editCalls.length,
      editSuccesses: editSuccesses.length,
      duration,
    };
  }

  const validation = tc.validate(finalContent);

  return {
    passed: validation.passed,
    editCalls: editCalls.length,
    editSuccesses: editSuccesses.length,
    duration,
  };
}

// ── Main ──────────────────────────────────────────────────────
const main = async () => {
  console.log(
    `\n${BOLD}Headless Edit Operations Test — ${TEST_CASES.length} Types${RESET}\n`
  );

  const testDir = join(tmpdir(), `edit-ops-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  info(`Test dir: ${testDir}`);
  console.log();

  let totalPassed = 0;
  const results: { name: string; passed: boolean; detail: string }[] = [];

  for (const tc of TEST_CASES) {
    console.log(`${CYAN}${BOLD}${tc.name}${RESET}`);
    info(`File: ${tc.fileName}`);
    info(`Prompt: "${tc.prompt.slice(0, 80)}..."`);

    try {
      const result = await runTestCase(tc, testDir);
      const status = result.passed
        ? `${GREEN}PASS${RESET}`
        : `${RED}FAIL${RESET}`;
      const detail = `edit_file: ${result.editSuccesses}/${result.editCalls} succeeded, ${(result.duration / 1000).toFixed(1)}s`;

      console.log(`  ${status} — ${detail}`);

      if (result.passed) {
        totalPassed++;
        // Validate the file to show reason
        const content = readFileSync(join(testDir, tc.fileName), "utf-8");
        const v = tc.validate(content);
        pass(v.reason);
      } else {
        const content = readFileSync(join(testDir, tc.fileName), "utf-8");
        const v = tc.validate(content);
        fail(v.reason);
        info(
          `Final content:\n${content
            .split("\n")
            .map((l, i) => `    ${i + 1}: ${l}`)
            .join("\n")}`
        );
      }

      results.push({ name: tc.name, passed: result.passed, detail });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ${RED}ERROR${RESET} — ${msg.slice(0, 200)}`);
      fail(msg.slice(0, 200));
      results.push({ name: tc.name, passed: false, detail: msg.slice(0, 100) });
    }

    // Reset file for next test (in case of side effects)
    try {
      rmSync(join(testDir, tc.fileName), { force: true });
    } catch (error) {
      warn(`cleanup failed for ${tc.fileName}: ${error}`);
    }

    console.log();
  }

  // Summary
  console.log(`${BOLD}━━━ Summary ━━━${RESET}`);
  for (const r of results) {
    const icon = r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} ${r.name} — ${r.detail}`);
  }
  console.log();
  console.log(
    `${BOLD}Result: ${totalPassed}/${TEST_CASES.length} passed (${Math.round((totalPassed / TEST_CASES.length) * 100)}%)${RESET}`
  );

  // Cleanup
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch (error) {
    warn(`cleanup failed for ${testDir}: ${error}`);
  }

  if (totalPassed === TEST_CASES.length) {
    console.log(
      `\n${BOLD}${GREEN}🎉 ALL TESTS PASSED — 100% success rate!${RESET}\n`
    );
    process.exit(0);
  } else {
    console.log(`\n${BOLD}${RED}Some tests failed.${RESET}\n`);
    process.exit(1);
  }
};

main();
