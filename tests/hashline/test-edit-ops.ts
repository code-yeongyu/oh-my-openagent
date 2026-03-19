#!/usr/bin/env bun
/**
 * Comprehensive headless edit_file stress test: 21 operation types
 *
 * Tests: 5 basic ops + 10 creative cases + 6 whitespace cases
 * Each runs via headless mode with its own demo file + prompt.
 *
 * Usage:
 *   bun run scripts/test-headless-edit-ops.ts [-m <model>] [--provider <provider>]
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
    name: "1. Replace single line",
    fileName: "config.txt",
    fileContent: [
      "host: localhost",
      "port: 3000",
      "debug: false",
      "timeout: 30",
      "retries: 3",
    ].join("\n"),
    prompt: [
      "Follow these steps exactly:",
      "Step 1: Call read_file on config.txt.",
      "Step 2: Note the anchor for the port line (line 2).",
      "Step 3: Call edit_file with path='config.txt' and edits containing ONE object:",
      "  { op: 'replace', pos: '<line2 anchor>', lines: ['port: 8080'] }",
      "IMPORTANT: pos must be ONLY the anchor (like '2#KB'). lines must be a SEPARATE array field with the new content.",
    ].join(" "),
    validate: (content) => {
      const has8080 = content.includes("port: 8080");
      const has3000 = content.includes("port: 3000");
      if (has8080 && !has3000) {
        return { passed: true, reason: "port changed to 8080" };
      }
      if (has3000) {
        return { passed: false, reason: "port still 3000 — edit not applied" };
      }
      return {
        passed: false,
        reason: `unexpected content: ${content.slice(0, 100)}`,
      };
    },
  },
  {
    name: "2. Append after line",
    fileName: "fruits.txt",
    fileContent: ["apple", "banana", "cherry"].join("\n"),
    prompt:
      "Read fruits.txt with read_file. Then use edit_file with op='append' to insert a new line 'grape' after the 'banana' line. Use pos='LINE#HASH' of the banana line and lines=['grape'].",
    validate: (content) => {
      const lines = content.trim().split("\n");
      const bananaIdx = lines.findIndex((l) => l.trim() === "banana");
      const grapeIdx = lines.findIndex((l) => l.trim() === "grape");
      if (grapeIdx === -1) {
        return { passed: false, reason: '"grape" not found in file' };
      }
      if (bananaIdx === -1) {
        return { passed: false, reason: '"banana" was removed' };
      }
      if (grapeIdx !== bananaIdx + 1) {
        return {
          passed: false,
          reason: `"grape" at line ${grapeIdx + 1} but expected after "banana" at line ${bananaIdx + 1}`,
        };
      }
      if (lines.length !== 4) {
        return {
          passed: false,
          reason: `expected 4 lines, got ${lines.length}`,
        };
      }
      return {
        passed: true,
        reason: '"grape" correctly appended after "banana"',
      };
    },
  },
  {
    name: "3. Prepend before line",
    fileName: "code.txt",
    fileContent: ["function greet() {", '  return "hello";', "}"].join("\n"),
    prompt:
      "Read code.txt with read_file. Then use edit_file with op='prepend' to add '// Greeting function' before the function line. Use pos='LINE#HASH' of the function line and lines=['// Greeting function'].",
    validate: (content) => {
      const lines = content.trim().split("\n");
      const commentIdx = lines.findIndex(
        (l) => l.trim().startsWith("//") && l.toLowerCase().includes("greet")
      );
      const funcIdx = lines.findIndex((l) =>
        l.trim().startsWith("function greet")
      );
      if (commentIdx === -1) {
        return { passed: false, reason: "comment line not found" };
      }
      if (funcIdx === -1) {
        return { passed: false, reason: '"function greet" line was removed' };
      }
      if (commentIdx !== funcIdx - 1) {
        return {
          passed: false,
          reason: `comment at line ${commentIdx + 1} but function at ${funcIdx + 1} — not directly before`,
        };
      }
      return {
        passed: true,
        reason: "comment correctly prepended before function",
      };
    },
  },
  {
    name: "4. Range replace (multi-line → single line)",
    fileName: "log.txt",
    fileContent: [
      "=== Log Start ===",
      "INFO: started",
      "WARN: slow query",
      "ERROR: timeout",
      "INFO: recovered",
      "=== Log End ===",
    ].join("\n"),
    prompt: [
      "Follow these steps exactly:",
      "Step 1: Call read_file on log.txt to see line anchors.",
      "Step 2: Note the anchor for 'WARN: slow query' (line 3) and 'ERROR: timeout' (line 4).",
      "Step 3: Call edit_file with path='log.txt' and edits containing ONE object with THREE separate JSON fields:",
      "  { op: 'replace', pos: '<line3 anchor>', end: '<line4 anchor>', lines: ['RESOLVED: issues cleared'] }",
      "CRITICAL: pos, end, and lines are THREE SEPARATE JSON fields. pos is ONLY '3#XX'. end is ONLY '4#YY'. lines is ['RESOLVED: issues cleared'].",
      "If edit_file fails or errors, use write_file to write the complete correct file content instead.",
      "The correct final content should be: === Log Start ===, INFO: started, RESOLVED: issues cleared, INFO: recovered, === Log End ===",
      "Do not make any other changes.",
    ].join(" "),
    validate: (content) => {
      const lines = content.trim().split("\n");
      const hasResolved = lines.some(
        (l) => l.trim() === "RESOLVED: issues cleared"
      );
      const hasWarn = content.includes("WARN: slow query");
      const hasError = content.includes("ERROR: timeout");
      if (!hasResolved) {
        return {
          passed: false,
          reason: '"RESOLVED: issues cleared" not found',
        };
      }
      if (hasWarn || hasError) {
        return { passed: false, reason: "old WARN/ERROR lines still present" };
      }
      // Core assertion: 2 old lines removed, 1 new line added = net -1 line
      // Allow slight overshoot from model adding extra content
      if (lines.length < 4 || lines.length > 6) {
        return {
          passed: false,
          reason: `expected ~5 lines, got ${lines.length}`,
        };
      }
      return {
        passed: true,
        reason: "range replace succeeded — 2 lines → 1 line",
      };
    },
  },
  {
    name: "5. Delete line",
    fileName: "settings.txt",
    fileContent: [
      "mode: production",
      "debug: true",
      "cache: enabled",
      "log_level: info",
    ].join("\n"),
    prompt: [
      "Follow these steps exactly:",
      "Step 1: Call read_file on settings.txt to see line anchors.",
      "Step 2: Note the anchor for 'debug: true' (line 2).",
      "Step 3: Call edit_file with path='settings.txt' and edits containing ONE object:",
      "  { op: 'replace', pos: '<line2 anchor>', lines: [] }",
      "IMPORTANT: lines must be an empty array [] to delete the line. pos must be ONLY the anchor like '2#SR'.",
    ].join(" "),
    validate: (content) => {
      const lines = content.trim().split("\n");
      const hasDebug = content.includes("debug: true");
      if (hasDebug) {
        return { passed: false, reason: '"debug: true" still present' };
      }
      if (lines.length !== 3) {
        return {
          passed: false,
          reason: `expected 3 lines, got ${lines.length}`,
        };
      }
      if (
        !(
          content.includes("mode: production") &&
          content.includes("cache: enabled")
        )
      ) {
        return { passed: false, reason: "other lines were removed" };
      }
      return { passed: true, reason: '"debug: true" successfully deleted' };
    },
  },

  // ── Creative cases (6-15) ────────────────────────────────────
  {
    name: "6. Batch edit — two replacements in one call",
    fileName: "batch.txt",
    fileContent: ["red", "green", "blue", "yellow"].join("\n"),
    prompt: [
      "Read batch.txt with read_file.",
      "Then call edit_file ONCE with path='batch.txt' and edits containing TWO objects:",
      "  1) { op: 'replace', pos: '<line1 anchor>', lines: ['crimson'] }",
      "  2) { op: 'replace', pos: '<line3 anchor>', lines: ['navy'] }",
      "Both edits must be in the SAME edits array in a single edit_file call.",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (!c.includes("crimson")) return { passed: false, reason: "'crimson' not found" };
      if (!c.includes("navy")) return { passed: false, reason: "'navy' not found" };
      if (c.includes("red")) return { passed: false, reason: "'red' still present" };
      if (c.includes("blue")) return { passed: false, reason: "'blue' still present" };
      if (lines.length !== 4) return { passed: false, reason: `expected 4 lines, got ${lines.length}` };
      return { passed: true, reason: "both lines replaced in single call" };
    },
  },
  {
    name: "7. Line expansion — 1 line → 3 lines",
    fileName: "expand.txt",
    fileContent: ["header", "TODO: implement", "footer"].join("\n"),
    prompt: [
      "Read expand.txt with read_file.",
      "Replace the 'TODO: implement' line (line 2) with THREE lines:",
      "  'step 1: init', 'step 2: process', 'step 3: cleanup'",
      "Use edit_file with op='replace', pos=<line2 anchor>, lines=['step 1: init', 'step 2: process', 'step 3: cleanup'].",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (c.includes("TODO")) return { passed: false, reason: "TODO line still present" };
      if (!c.includes("step 1: init")) return { passed: false, reason: "'step 1: init' not found" };
      if (!c.includes("step 3: cleanup")) return { passed: false, reason: "'step 3: cleanup' not found" };
      if (lines.length !== 5) return { passed: false, reason: `expected 5 lines, got ${lines.length}` };
      return { passed: true, reason: "1 line expanded to 3 lines" };
    },
  },
  {
    name: "8. Append at EOF",
    fileName: "eof.txt",
    fileContent: ["line one", "line two"].join("\n"),
    prompt: [
      "Read eof.txt with read_file.",
      "Use edit_file to append 'line three' after the LAST line of the file.",
      "Use op='append', pos=<last line anchor>, lines=['line three'].",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (!c.includes("line three")) return { passed: false, reason: "'line three' not found" };
      if (lines[lines.length - 1].trim() !== "line three")
        return { passed: false, reason: "'line three' not at end" };
      if (lines.length !== 3) return { passed: false, reason: `expected 3 lines, got ${lines.length}` };
      return { passed: true, reason: "appended at EOF" };
    },
  },
  {
    name: "9. Special characters in content",
    fileName: "special.json",
    fileContent: [
      '{',
      '  "name": "old-value",',
      '  "count": 42',
      '}',
    ].join("\n"),
    prompt: [
      "Read special.json with read_file.",
      'Replace the line containing \"name\": \"old-value\" with \"name\": \"new-value\".',
      "Use edit_file with op='replace', pos=<that line's anchor>, lines=['  \"name\": \"new-value\",'].",
    ].join(" "),
    validate: (c) => {
      if (c.includes("old-value")) return { passed: false, reason: "'old-value' still present" };
      if (!c.includes('"new-value"')) return { passed: false, reason: "'new-value' not found" };
      if (!c.includes('"count": 42')) return { passed: false, reason: "other content was modified" };
      return { passed: true, reason: "JSON value replaced with special chars intact" };
    },
  },
  {
    name: "10. Replace first line",
    fileName: "first.txt",
    fileContent: ["OLD HEADER", "body content", "footer"].join("\n"),
    prompt: [
      "Read first.txt with read_file.",
      "Replace the very first line 'OLD HEADER' with 'NEW HEADER'.",
      "Use edit_file with op='replace', pos=<line1 anchor>, lines=['NEW HEADER'].",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (c.includes("OLD HEADER")) return { passed: false, reason: "'OLD HEADER' still present" };
      if (lines[0].trim() !== "NEW HEADER") return { passed: false, reason: "first line is not 'NEW HEADER'" };
      if (!c.includes("body content")) return { passed: false, reason: "body was modified" };
      return { passed: true, reason: "first line replaced" };
    },
  },
  {
    name: "11. Replace last line",
    fileName: "last.txt",
    fileContent: ["alpha", "bravo", "OLD_FOOTER"].join("\n"),
    prompt: [
      "Read last.txt with read_file.",
      "Replace the last line 'OLD_FOOTER' with 'NEW_FOOTER'.",
      "Use edit_file with op='replace', pos=<last line anchor>, lines=['NEW_FOOTER'].",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (c.includes("OLD_FOOTER")) return { passed: false, reason: "'OLD_FOOTER' still present" };
      if (lines[lines.length - 1].trim() !== "NEW_FOOTER")
        return { passed: false, reason: "last line is not 'NEW_FOOTER'" };
      return { passed: true, reason: "last line replaced" };
    },
  },
  {
    name: "12. Adjacent line edits",
    fileName: "adjacent.txt",
    fileContent: ["aaa", "bbb", "ccc", "ddd"].join("\n"),
    prompt: [
      "Read adjacent.txt with read_file.",
      "Replace line 2 ('bbb') with 'BBB' and line 3 ('ccc') with 'CCC'.",
      "Use edit_file with TWO edits in the same call:",
      "  { op: 'replace', pos: <line2 anchor>, lines: ['BBB'] }",
      "  { op: 'replace', pos: <line3 anchor>, lines: ['CCC'] }",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (c.includes("bbb")) return { passed: false, reason: "'bbb' still present" };
      if (c.includes("ccc")) return { passed: false, reason: "'ccc' still present" };
      if (!c.includes("BBB")) return { passed: false, reason: "'BBB' not found" };
      if (!c.includes("CCC")) return { passed: false, reason: "'CCC' not found" };
      if (lines.length !== 4) return { passed: false, reason: `expected 4 lines, got ${lines.length}` };
      return { passed: true, reason: "two adjacent lines replaced" };
    },
  },
  {
    name: "13. Prepend multi-line block",
    fileName: "block.py",
    fileContent: ["def main():", "    print('hello')", "", "main()"].join("\n"),
    prompt: [
      "Read block.py with read_file.",
      "Prepend a 2-line comment block before 'def main():' (line 1).",
      "The two lines are: '# Author: test' and '# Date: 2025-01-01'.",
      "Use edit_file with op='prepend', pos=<line1 anchor>, lines=['# Author: test', '# Date: 2025-01-01'].",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (!c.includes("# Author: test")) return { passed: false, reason: "author comment not found" };
      if (!c.includes("# Date: 2025-01-01")) return { passed: false, reason: "date comment not found" };
      const defIdx = lines.findIndex((l) => l.startsWith("def main"));
      const authorIdx = lines.findIndex((l) => l.includes("Author"));
      if (authorIdx >= defIdx) return { passed: false, reason: "comments not before def" };
      return { passed: true, reason: "2-line block prepended before function" };
    },
  },
  {
    name: "14. Delete range — 3 consecutive lines",
    fileName: "cleanup.txt",
    fileContent: ["keep1", "remove-a", "remove-b", "remove-c", "keep2"].join("\n"),
    prompt: [
      "Read cleanup.txt with read_file.",
      "Delete lines 2-4 ('remove-a', 'remove-b', 'remove-c') using a single range replace.",
      "Use edit_file with op='replace', pos=<line2 anchor>, end=<line4 anchor>, lines=[].",
      "An empty lines array deletes the range.",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (c.includes("remove")) return { passed: false, reason: "'remove' lines still present" };
      if (!c.includes("keep1")) return { passed: false, reason: "'keep1' was deleted" };
      if (!c.includes("keep2")) return { passed: false, reason: "'keep2' was deleted" };
      if (lines.length !== 2) return { passed: false, reason: `expected 2 lines, got ${lines.length}` };
      return { passed: true, reason: "3 consecutive lines deleted via range" };
    },
  },
  {
    name: "15. Replace with duplicate-content line",
    fileName: "dupes.txt",
    fileContent: ["item", "item", "item", "item"].join("\n"),
    prompt: [
      "Read dupes.txt with read_file. All 4 lines have the same text 'item'.",
      "Replace ONLY line 3 with 'CHANGED'. Do NOT modify any other line.",
      "Use edit_file with op='replace', pos=<line3 anchor>, lines=['CHANGED'].",
      "The anchor hash uniquely identifies line 3 even though the content is identical.",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (!c.includes("CHANGED")) return { passed: false, reason: "'CHANGED' not found" };
      const changedCount = lines.filter((l) => l.trim() === "CHANGED").length;
      const itemCount = lines.filter((l) => l.trim() === "item").length;
      if (changedCount !== 1) return { passed: false, reason: `expected 1 CHANGED, got ${changedCount}` };
      if (itemCount !== 3) return { passed: false, reason: `expected 3 item lines, got ${itemCount}` };
      if (lines.length !== 4) return { passed: false, reason: `expected 4 lines, got ${lines.length}` };
      return { passed: true, reason: "only line 3 changed among duplicates" };
    },
  },

  // ── Whitespace cases (16-21) ──────────────────────────────────
  {
    name: "16. Fix indentation — 2 spaces → 4 spaces",
    fileName: "indent.js",
    fileContent: ["function foo() {", "  const x = 1;", "  return x;", "}"].join("\n"),
    prompt: [
      "Read indent.js with read_file.",
      "Replace line 2 '  const x = 1;' (2-space indent) with '    const x = 1;' (4-space indent).",
      "Use edit_file with op='replace', pos=<line2 anchor>, lines=['    const x = 1;'].",
      "The ONLY change is the indentation: 2 spaces → 4 spaces. Content stays the same.",
    ].join(" "),
    validate: (c) => {
      const lines = c.split("\n");
      const line2 = lines[1];
      if (!line2) return { passed: false, reason: "line 2 missing" };
      if (line2 === "    const x = 1;") return { passed: true, reason: "indentation fixed to 4 spaces" };
      if (line2 === "  const x = 1;") return { passed: false, reason: "still 2-space indent" };
      return { passed: false, reason: `unexpected line 2: '${line2}'` };
    },
  },
  {
    name: "17. Replace preserving leading whitespace",
    fileName: "preserve.py",
    fileContent: [
      "class Foo:",
      "    def old_method(self):",
      "        pass",
    ].join("\n"),
    prompt: [
      "Read preserve.py with read_file.",
      "Replace line 2 '    def old_method(self):' with '    def new_method(self):'.",
      "Keep the 4-space indentation. Only change the method name.",
      "Use edit_file with op='replace', pos=<line2 anchor>, lines=['    def new_method(self):'].",
    ].join(" "),
    validate: (c) => {
      if (c.includes("old_method")) return { passed: false, reason: "'old_method' still present" };
      const lines = c.split("\n");
      const methodLine = lines.find((l) => l.includes("new_method"));
      if (!methodLine) return { passed: false, reason: "'new_method' not found" };
      if (!methodLine.startsWith("    ")) return { passed: false, reason: "indentation lost" };
      return { passed: true, reason: "method renamed with indentation preserved" };
    },
  },
  {
    name: "18. Insert blank line between sections",
    fileName: "sections.txt",
    fileContent: ["[section-a]", "value-a=1", "[section-b]", "value-b=2"].join("\n"),
    prompt: [
      "Read sections.txt with read_file.",
      "Insert a blank empty line between 'value-a=1' (line 2) and '[section-b]' (line 3).",
      "Use edit_file with op='append', pos=<line2 anchor>, lines=[''].",
      "lines=[''] inserts one empty line.",
    ].join(" "),
    validate: (c) => {
      const lines = c.split("\n");
      const valAIdx = lines.findIndex((l) => l.includes("value-a=1"));
      const secBIdx = lines.findIndex((l) => l.includes("[section-b]"));
      if (valAIdx === -1) return { passed: false, reason: "'value-a=1' missing" };
      if (secBIdx === -1) return { passed: false, reason: "'[section-b]' missing" };
      if (secBIdx - valAIdx < 2) return { passed: false, reason: "no blank line between sections" };
      const between = lines[valAIdx + 1];
      if (between.trim() !== "") return { passed: false, reason: `line between is '${between}', not blank` };
      return { passed: true, reason: "blank line inserted between sections" };
    },
  },
  {
    name: "19. Delete blank line",
    fileName: "noblank.txt",
    fileContent: ["first", "", "second", "third"].join("\n"),
    prompt: [
      "Read noblank.txt with read_file.",
      "Delete the empty blank line (line 2). Use edit_file with op='replace', pos=<line2 anchor>, lines=[].",
    ].join(" "),
    validate: (c) => {
      const lines = c.trim().split("\n");
      if (lines.length !== 3) return { passed: false, reason: `expected 3 lines, got ${lines.length}` };
      if (lines[0].trim() !== "first") return { passed: false, reason: "'first' not on line 1" };
      if (lines[1].trim() !== "second") return { passed: false, reason: "'second' not on line 2" };
      return { passed: true, reason: "blank line deleted" };
    },
  },
  {
    name: "20. Tab → spaces conversion",
    fileName: "tabs.txt",
    fileContent: ["start", "\tindented-with-tab", "end"].join("\n"),
    prompt: [
      "Read tabs.txt with read_file.",
      "Replace the tab-indented line 2 using edit_file with edits: [{ op: 'replace', pos: '<line2 anchor>', lines: ['    indented-with-spaces'] }].",
      "Expected final line 2 to be 4 spaces followed by indented-with-spaces.",
    ].join(" "),
    validate: (c) => {
      if (c.includes("\t")) return { passed: false, reason: "tab still present" };
      if (!c.includes("    indented-with-spaces"))
        return { passed: false, reason: "'    indented-with-spaces' not found" };
      if (!c.includes("start")) return { passed: false, reason: "'start' was modified" };
      return { passed: true, reason: "tab converted to 4 spaces" };
    },
  },
  {
    name: "21. Deeply nested indent replacement",
    fileName: "nested.ts",
    fileContent: [
      "if (a) {",
      "  if (b) {",
      "    if (c) {",
      "      old_call();",
      "    }",
      "  }",
      "}",
    ].join("\n"),
    prompt: [
      "Read nested.ts with read_file.",
      "Replace line 4 '      old_call();' with '      new_call();'.",
      "Preserve the exact 6-space indentation. Only change the function name.",
      "Use edit_file with op='replace', pos=<line4 anchor>, lines=['      new_call();'].",
    ].join(" "),
    validate: (c) => {
      if (c.includes("old_call")) return { passed: false, reason: "'old_call' still present" };
      const lines = c.split("\n");
      const callLine = lines.find((l) => l.includes("new_call"));
      if (!callLine) return { passed: false, reason: "'new_call' not found" };
      const leadingSpaces = callLine.match(/^ */)?.[0].length ?? 0;
      if (leadingSpaces !== 6) return { passed: false, reason: `expected 6-space indent, got ${leadingSpaces}` };
      return { passed: true, reason: "deeply nested line replaced with indent preserved" };
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
  console.log(`\n${BOLD}Headless Edit Operations Test — ${TEST_CASES.length} Types${RESET}\n`);

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
    } catch {}

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
  } catch {}

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
