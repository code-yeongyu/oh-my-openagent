#!/usr/bin/env bun
/**
 * Run every cross-surface thread-tool QA scenario in sequence and exit non-zero if any of
 * them fails. The scripts are run one at a time on purpose: each one owns a QA port and a
 * unix socket, and running them concurrently would make the port allocation the thing under
 * test instead of the thread tools.
 *
 * The desktop-backed lanes (desktop-client, terminal-to-ui, desktop-to-cli) need the private
 * desktop checkout at THREAD_QA_DESKTOP_ROOT. When its apps/server/package.json marker is
 * absent they are reported as SKIP and never spawned; set THREAD_QA_REQUIRE_DESKTOP=1 to turn
 * that skip into a FAIL on machines where the desktop lanes are expected to run.
 *
 * Usage: bun packages/omo-senpi/scripts/qa/thread-tools/run-all.mjs [--out-dir <dir>]
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { planScenarios, resolveDesktopRoot, summarize } from "./lib/plan-scenarios.mjs"

const here = dirname(fileURLToPath(import.meta.url))

const outDirIndex = process.argv.indexOf("--out-dir")
const outDir = outDirIndex === -1 ? undefined : process.argv[outDirIndex + 1]
if (outDir !== undefined) mkdirSync(outDir, { recursive: true })

const planned = planScenarios({ desktopRoot: resolveDesktopRoot(process.env), env: process.env })

const results = []
for (const scenario of planned) {
  process.stdout.write(`\n===== ${scenario.name} =====\n`)
  if (scenario.mode !== "run") {
    process.stdout.write(`----- ${scenario.name} ${scenario.mode}: ${scenario.reason} -----\n`)
    results.push({ name: scenario.name, mode: scenario.mode, reason: scenario.reason })
    continue
  }
  const args = [process.execPath, join(here, scenario.file)]
  if (outDir !== undefined) args.push("--out", join(outDir, `${scenario.name}.txt`))
  const child = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" })
  results.push({ name: scenario.name, mode: "run", code: child.exitCode })
  process.stdout.write(`----- ${scenario.name} exit=${child.exitCode} -----\n`)
}

const summary = summarize(results)
process.stdout.write("\n===== summary =====\n")
for (const line of summary.lines) process.stdout.write(`${line}\n`)
process.exit(summary.exitCode)
