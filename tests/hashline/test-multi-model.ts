#!/usr/bin/env bun
/**
 * Multi-model edit_file test runner
 *
 * Runs test-headless-edit-ops.ts against every available model
 * and produces a summary table.
 *
 * Usage:
 *   bun run scripts/test-multi-model-edit.ts [--timeout <seconds>]
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

// ── Models ────────────────────────────────────────────────────
const MODELS = [
  { id: "minimax-m2.5-free", short: "M2.5-Free" },
];

// ── CLI args ──────────────────────────────────────────────────
let perModelTimeoutSec = 900; // 15 min default per model (5 tests)
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--timeout" && i + 1 < rawArgs.length) {
    const parsed = Number.parseInt(rawArgs[i + 1], 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      console.error(`Invalid --timeout value: ${rawArgs[i + 1]}`);
      process.exit(1);
    }
    perModelTimeoutSec = parsed;
    i++;
}

// ── Colors ────────────────────────────────────────────────────
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

// ── Types ─────────────────────────────────────────────────────
interface TestResult {
  detail: string;
  name: string;
  passed: boolean;
}

interface ModelResult {
  durationMs: number;
  error?: string;
  modelId: string;
  modelShort: string;
  tests: TestResult[];
  totalPassed: number;
  totalTests: number;
}

// ── Parse test-headless-edit-ops stdout ───────────────────────
function parseOpsOutput(stdout: string): TestResult[] {
  const results: TestResult[] = [];

  // Match lines like: "  PASS — edit_file: 1/1 succeeded, 32.5s"
  // or "  FAIL — edit_file: 0/3 succeeded, 15.2s"
  // or "  ERROR — Timed out after 10 minutes"
  // Following a line like: "1. Replace single line"
  const lines = stdout.split("\n");

  let currentTestName = "";
  for (const line of lines) {
    // Detect test name: starts with ANSI-colored bold cyan + "N. Name"
    // Strip ANSI codes for matching
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");

    // Test name pattern: "N. <name>"
    const testNameMatch = stripped.match(/^\s*(\d+\.\s+.+)$/);
    if (
      testNameMatch &&
      !stripped.includes("—") &&
      !stripped.includes("✓") &&
      !stripped.includes("✗")
    ) {
      currentTestName = testNameMatch[1].trim();
      continue;
    }

    // Result line: PASS/FAIL/ERROR
    if (currentTestName && stripped.includes("PASS")) {
      const detail = stripped.replace(/^\s*PASS\s*—?\s*/, "").trim();
      results.push({
        name: currentTestName,
        passed: true,
        detail: detail || "passed",
      });
      currentTestName = "";
    } else if (currentTestName && stripped.includes("FAIL")) {
      const detail = stripped.replace(/^\s*FAIL\s*—?\s*/, "").trim();
      results.push({
        name: currentTestName,
        passed: false,
        detail: detail || "failed",
      });
      currentTestName = "";
    } else if (currentTestName && stripped.includes("ERROR")) {
      const detail = stripped.replace(/^\s*ERROR\s*—?\s*/, "").trim();
      results.push({
        name: currentTestName,
        passed: false,
        detail: detail || "error",
      });
      currentTestName = "";
    }
  }

  return results;
}

// ── Run one model ────────────────────────────────────────────
async function runModel(model: {
  id: string;
  short: string;
}): Promise<ModelResult> {
  const opsScript = resolve(import.meta.dir, "test-edit-ops.ts");
  const startTime = Date.now();

  return new Promise<ModelResult>((resolvePromise) => {
    const proc = spawn(
      "bun",
      ["run", opsScript, "-m", model.id, "--no-translate"],
      {
        cwd: resolve(import.meta.dir),
        env: { ...process.env, BUN_INSTALL: process.env.BUN_INSTALL },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolvePromise({
        modelId: model.id,
        modelShort: model.short,
        tests: [],
        totalPassed: 0,
        totalTests: 0,
        durationMs: Date.now() - startTime,
        error: `Timed out after ${perModelTimeoutSec}s`,
      });
    }, perModelTimeoutSec * 1000);

    proc.on("close", () => {
      clearTimeout(timeout);
      const tests = parseOpsOutput(stdout);
      const totalPassed = tests.filter((t) => t.passed).length;

      resolvePromise({
        modelId: model.id,
        modelShort: model.short,
        tests,
        totalPassed,
        totalTests: Math.max(tests.length, 5),
        durationMs: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolvePromise({
        modelId: model.id,
        modelShort: model.short,
        tests: [],
        totalPassed: 0,
        totalTests: 0,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

// ── Main ──────────────────────────────────────────────────────
const main = async () => {
  console.log(`\n${BOLD}═══ Multi-Model edit_file Test Runner ═══${RESET}\n`);
  console.log(`${DIM}Models: ${MODELS.map((m) => m.short).join(", ")}${RESET}`);
  console.log(`${DIM}Timeout: ${perModelTimeoutSec}s per model${RESET}`);
  console.log();

  const allResults: ModelResult[] = [];

  for (const model of MODELS) {
    console.log(`${CYAN}${BOLD}▶ Testing ${model.short} (${model.id})${RESET}`);
    const result = await runModel(model);
    allResults.push(result);

    const timeStr = `${(result.durationMs / 1000).toFixed(1)}s`;
    if (result.error) {
      console.log(`  ${RED}ERROR${RESET}: ${result.error} (${timeStr})`);
    } else {
      const color =
        result.totalPassed === result.totalTests
          ? GREEN
          : result.totalPassed > 0
            ? YELLOW
            : RED;
      console.log(
        `  ${color}${result.totalPassed}/${result.totalTests} passed${RESET} (${timeStr})`
      );
      for (const t of result.tests) {
        const icon = t.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
        console.log(`    ${icon} ${t.name}`);
      }
    }
    console.log();
  }

  // ── Summary Table ──────────────────────────────────────────
  console.log(`${BOLD}═══ Summary ═══${RESET}\n`);

  // Per-model results
  for (const r of allResults) {
    const timeStr = `${(r.durationMs / 1000).toFixed(0)}s`;
    const color = r.error ? RED : r.totalPassed === r.totalTests ? GREEN : r.totalPassed > 0 ? YELLOW : RED;
    const label = r.error ? `ERROR: ${r.error}` : `${r.totalPassed}/${r.totalTests}`;
    console.log(`  ${r.modelShort.padEnd(8)} ${color}${label}${RESET} (${timeStr})`);
    for (const t of r.tests) {
      const icon = t.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      console.log(`    ${icon} ${t.name}`);
    }
  }

  console.log();

  // Overall
  const totalModels = allResults.length;
  const erroredModels = allResults.filter((r) => r.error).length;
  const perfectModels = allResults.filter(
    (r) => !r.error && r.totalPassed === r.totalTests && r.totalTests > 0
  ).length;
  console.log(
    `${BOLD}Models with 100%: ${perfectModels}/${totalModels}${RESET}`
  );

  const overallPassed = allResults.reduce((sum, r) => sum + r.totalPassed, 0);
  const overallTotal = allResults.reduce((sum, r) => sum + r.totalTests, 0);
  console.log(
    `${BOLD}Overall: ${overallPassed}/${overallTotal} (${Math.round((overallPassed / overallTotal) * 100)}%)${RESET}`
  );

  console.log();

  if (erroredModels > 0) {
    console.log(
      `${BOLD}${RED}${erroredModels} model(s) errored. See details above.${RESET}\n`
    );
    process.exit(1);
  } else if (perfectModels === totalModels) {
    console.log(`${BOLD}${GREEN}🎉 ALL MODELS PASSED ALL TESTS!${RESET}\n`);
    process.exit(0);
  } else {
    console.log(
      `${BOLD}${YELLOW}Some models have failures. See details above.${RESET}\n`
    );
    process.exit(1);
  }
};

main();
