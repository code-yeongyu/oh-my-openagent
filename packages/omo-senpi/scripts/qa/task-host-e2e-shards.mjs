#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { runCrashMatrix, controlRowForReport, crashRowsForReport } from "./task-host-e2e-shards-crash.mjs"
import { runContractMatrix } from "./task-host-e2e-shards-contracts.mjs"
import { evaluateShardFaultReport, CONTROL_ID, SCENARIO_IDS } from "./task-host-e2e-shards-eval.mjs"
import { runMixedEngineScenario } from "./task-host-e2e-shards-handoff.mjs"
import { runHandoffSuccessorMatrix } from "./task-host-e2e-shards-handoff-successors.mjs"
import { runIndexLiveMatrix } from "./task-host-e2e-shards-index-live.mjs"
import { runNestedMatrix } from "./task-host-e2e-shards-nested.mjs"
import { runRollbackLiveMatrix } from "./task-host-e2e-shards-rollback-live.mjs"
import { runRetainLiveMatrix } from "./task-host-e2e-shards-retain-live.mjs"
import { sandboxProcesses } from "./task-host-e2e-process.mjs"
import {
  binaryDigest,
  changedRealAgentFiles,
  createRunRoot,
  realAgentDigests,
} from "./task-host-e2e-sandbox.mjs"
import { provisionConfig } from "./task-host-e2e-shard-cost-support.mjs"

function parseArgs(argv) {
  const options = { control: false, keepSandbox: false, only: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--control") options.control = true
    else if (flag === "--keep-sandbox") options.keepSandbox = true
    else if (flag === "--only") options.only.push(...argv[++index].split(",").filter(Boolean))
    else if (flag.startsWith("--")) options[flag.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase())] = argv[++index]
  }
  return options
}

function artifactTable(report) {
  const lines = [
    "# rpc-host-sharding todo 14 fault matrix",
    "",
    `mode: ${report.mode}`,
    `verdict: ${report.verdict.verdict} (${report.verdict.passed}/${report.verdict.expected})`,
    "",
    "| scenario | verdict | evidence |",
    "|---|---|---|",
  ]
  for (const row of report.verdict.rows) {
    lines.push(`| ${row.id} | ${row.verdict} | ${row.evidence.join("<br>")} |`)
  }
  return `${lines.join("\n")}\n`
}

function unimplementedRows(existing) {
  return Object.fromEntries(SCENARIO_IDS.filter((id) => existing[id] === undefined).map((id) => [
    id,
    {
      status: "fail",
      evidence: [],
      reason: "scenario group has not produced evidence",
    },
  ]))
}

function sweep(root) {
  const before = sandboxProcesses({ root })
  for (const entry of before) {
    try {
      process.kill(entry.pid, "SIGKILL")
    } catch {
      // gone
    }
  }
  return {
    before: before.map((entry) => entry.pid),
    after: sandboxProcesses({ root }).map((entry) => entry.pid),
  }
}

async function main(options) {
  if (process.platform === "win32") {
    console.log(JSON.stringify({ result: "SKIP", reason: "per-parent host shards are POSIX-only" }))
    return 0
  }
  const bin = options.bin ?? process.env.SENPI_BIN
  if (options.control && options.beforeBin === undefined) throw new Error("--control requires --before-bin <R0 compiled omo>")
  if (!options.control && bin === undefined) throw new Error("--bin <compiled branch omo> or SENPI_BIN is required")
  const out = resolve(options.out ?? "task-host-e2e-shards-out")
  mkdirSync(out, { recursive: true })
  const runRoot = createRunRoot()
  const realBefore = realAgentDigests()
  const binaries = {}
  const scenarios = {}
  const gates = {}
  const errors = {}
  const started = new Date().toISOString()
  const only = new Set(options.only)
  const selected = (name) => only.size === 0 || only.has(name)
  try {
    if (options.control) {
      const control = provisionConfig("control", resolve(options.beforeBin), runRoot)
      binaries.control = { path: control.bin, version: control.version, sha256: control.digest }
      const facts = await runCrashMatrix(control, out)
      scenarios[CONTROL_ID] = controlRowForReport(facts, out)
    } else {
      const sharded = provisionConfig("sharded", resolve(bin), runRoot)
      binaries.sharded = { path: sharded.bin, version: sharded.version, sha256: sharded.digest }
      if (options.beforeBin !== undefined) {
        binaries.control = {
          path: resolve(options.beforeBin),
          sha256: binaryDigest(resolve(options.beforeBin)),
        }
      }
      if (selected("crash")) {
        try {
          Object.assign(scenarios, crashRowsForReport(await runCrashMatrix(sharded, out), out))
        } catch (error) {
          errors.crash = String(error?.stack ?? error)
        }
      }
      if (selected("nested")) {
        try {
          Object.assign(scenarios, await runNestedMatrix(sharded, out))
        } catch (error) {
          errors.nested = String(error?.stack ?? error)
        }
      }
      if (selected("handoff")) {
        if (options.olderBin === undefined) {
          errors.handoff = "--older-bin <stamped lower-ordinal sharded omo> is required"
        } else {
          try {
            Object.assign(scenarios, await runMixedEngineScenario(sharded, resolve(options.olderBin), out))
          } catch (error) {
            errors.handoff = String(error?.stack ?? error)
          }
        }
      }
      if (selected("handoff-successors")) {
        if (options.olderBin === undefined) {
          errors.handoffSuccessors = "--older-bin <stamped lower-ordinal sharded omo> is required"
        } else {
          try {
            Object.assign(scenarios, await runHandoffSuccessorMatrix(sharded, resolve(options.olderBin), out))
          } catch (error) {
            errors.handoffSuccessors = String(error?.stack ?? error)
          }
        }
      }
      if (selected("index")) {
        if (options.beforeBin === undefined) {
          errors.index = "--before-bin <R0 compiled omo> is required"
        } else {
          try {
            Object.assign(scenarios, await runIndexLiveMatrix(sharded, resolve(options.beforeBin), out))
          } catch (error) {
            errors.index = String(error?.stack ?? error)
          }
        }
      }
      if (selected("rollback")) {
        if (options.beforeBin === undefined) {
          errors.rollback = "--before-bin <R0 compiled omo> is required"
        } else {
          try {
            Object.assign(scenarios, await runRollbackLiveMatrix(sharded, resolve(options.beforeBin), out))
          } catch (error) {
            errors.rollback = String(error?.stack ?? error)
          }
        }
      }
      if (selected("retain")) {
        try {
          Object.assign(scenarios, await runRetainLiveMatrix(sharded, out))
        } catch (error) {
          errors.retain = String(error?.stack ?? error)
        }
      }
      if (selected("contracts")) {
        try {
          gates.contracts = runContractMatrix(process.cwd(), out)
        } catch (error) {
          errors.contracts = String(error?.stack ?? error)
          gates.contracts = { status: "fail", evidence: [], reason: errors.contracts }
        }
      }
      Object.assign(scenarios, unimplementedRows(scenarios))
    }
  } finally {
    const swept = sweep(runRoot)
    if (!options.keepSandbox) rmSync(runRoot, { recursive: true, force: true })
    const realAfter = realAgentDigests()
    const partial = {
      plan_todo: 14,
      mode: options.control ? "control" : "full",
      started,
      finished: new Date().toISOString(),
      binaries,
      scenarios,
      gates,
      errors,
      real_agent_dir: {
        before: realBefore,
        after: realAfter,
        credentials_untouched: Object.keys(realBefore).every((dir) =>
          realBefore[dir]?.credentials === realAfter[dir]?.credentials),
        changed_watched_files: changedRealAgentFiles(realBefore, realAfter),
      },
      cleanup: {
        ...swept,
        run_root: runRoot,
        run_root_removed: !existsSync(runRoot),
      },
    }
    const verdict = evaluateShardFaultReport(partial)
    const report = { ...partial, verdict }
    writeFileSync(resolve(out, "fault-matrix.json"), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(resolve(out, "fault-matrix.md"), artifactTable(report))
    console.log(JSON.stringify({
      pass: verdict.exitCode === 0,
      mode: report.mode,
      verdict: verdict.verdict,
      passed: verdict.passed,
      expected: verdict.expected,
      failed: verdict.failed,
      out,
    }))
    return verdict.exitCode
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith("task-host-e2e-shards.mjs")) {
  const options = parseArgs(process.argv.slice(2))
  main(options).then((code) => {
    process.exitCode = code
  }, (error) => {
    console.error(error?.stack ?? error)
    process.exitCode = 1
  })
}

export { main, parseArgs }
