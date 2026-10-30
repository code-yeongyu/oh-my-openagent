#!/usr/bin/env node
// Live QA of task children hosted by `omo daemon` (todo 41), driven against a REAL compiled omo binary.
//
//   node packages/omo-senpi/scripts/qa/task-host-e2e.mjs --bin <omob bin> --out <evidence dir>
//   node packages/omo-senpi/scripts/qa/task-host-e2e.mjs --self-test          # no binary needed
//   node packages/omo-senpi/scripts/qa/task-host-e2e.mjs --baseline --bin <mainline omob> --out <dir>
//
// Optional gates: --legacy-bin (H), --second-bin (E/E2/E3), --newer-senpi (E4), --legacy-engine-cli (H2),
// --only A,B,I. Exit is non-zero when ANY scenario fails; a `skipped` scenario names what it needs and
// the exact command that would run it, and never reads as a pass.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  binaryDigest,
  createRunRoot,
  injectDaemonMockProvider,
  provisionRuntime,
  REAL_AGENT_DIRS,
} from "./task-host-e2e-sandbox.mjs"
import { globalModeRpcCount, parentArgv, sandboxProcesses } from "./task-host-e2e-process.mjs"
import { probeChildSessionOpen, probeSessionContext } from "./task-host-e2e-engine-probe.mjs"
import { scenarioA, scenarioA1, scenarioB, scenarioI } from "./task-host-e2e-scenarios.mjs"
import { scenarioC, scenarioC2 } from "./task-host-e2e-team.mjs"
import { scenarioF, scenarioG, scenarioH } from "./task-host-e2e-ops.mjs"
import { scenarioD, scenarioE4, scenarioH2, scenarioHandoffSuite } from "./task-host-e2e-gated.mjs"
import { scenarioJ } from "./task-host-e2e-reattach.mjs"
import { scenarioK } from "./task-host-e2e-threads.mjs"
import { baselineScenarios } from "./task-host-e2e-baseline.mjs"
import { runSelfTest } from "./task-host-e2e-selftest.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const MOCK_ENTRY = join(scriptDir, "task-host-e2e-mock-provider.mjs")
const SUMMARY_NAMES = ["task-host-e2e.json", "task-41-senpi-task-daemon-host-runner-v2.json"]
const SCENARIOS = [
  ["A", scenarioA],
  ["A1", scenarioA1],
  ["B", scenarioB],
  ["C", scenarioC],
  ["C2", scenarioC2],
  ["D", scenarioD],
  ["E", scenarioHandoffSuite],
  ["E4", scenarioE4],
  ["F", scenarioF],
  ["G", scenarioG],
  ["H", scenarioH],
  ["H2", scenarioH2],
  ["I", scenarioI],
  ["J", scenarioJ],
  ["K", scenarioK],
]

function parseArgs(argv) {
  const options = { only: undefined, baseline: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--baseline") options.baseline = true
    else if (flag.startsWith("--")) options[camel(flag.slice(2))] = argv[index + 1]
  }
  return options
}

function camel(flag) {
  return flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function transcript(result, header) {
  const lines = [...header, "", `scenario ${result.scenario}: ${result.title}`, `status: ${result.status}`]
  if (result.reason !== undefined) lines.push(`reason: ${result.reason}`)
  if (result.command !== undefined) lines.push(`command: ${result.command}`)
  if (result.facts !== undefined) lines.push("", "facts:", JSON.stringify(result.facts, null, 2))
  if (result.receipt !== undefined) lines.push("", "cleanup receipt:", JSON.stringify(result.receipt, null, 2))
  return `${lines.join("\n")}\n`
}

async function main(options) {
  if (process.platform === "win32") {
    console.log(JSON.stringify({ result: "SKIP", reason: "a shared daemon needs a unix socket, which win32 does not provide" }))
    return 0
  }
  const bin = options.bin === undefined ? undefined : resolve(options.bin)
  const out = resolve(options.out ?? join(process.cwd(), "task-host-e2e-out"))
  if (bin === undefined) {
    console.log(JSON.stringify({ result: "FAIL", reason: "--bin <omo binary> is required (or pass --self-test)" }))
    return 1
  }
  mkdirSync(out, { recursive: true })
  const binaryBefore = binaryDigest(bin)
  const runRoot = createRunRoot()
  const runtime = provisionRuntime(bin, runRoot)
  const injected = injectDaemonMockProvider(runtime.pluginRoot, MOCK_ENTRY)
  const run = {
    bin,
    home: runtime.home,
    runRoot,
    mockEntry: MOCK_ENTRY,
    legacyBin: optionalPath(options.legacyBin),
    secondBin: optionalPath(options.secondBin),
    newerSenpi: optionalPath(options.newerSenpi),
    legacyEngineCli: optionalPath(options.legacyEngineCli),
    parentArgs: (sandbox, prompt) => parentArgv(sandbox, MOCK_ENTRY, prompt),
    probeSessionContext,
    probeChildSessionOpen,
  }
  const header = [
    `binary: ${bin}`,
    `binary --version: ${runtime.version.replace(/\n/g, " | ")}`,
    `run root: ${runRoot}`,
    `daemon launch spec: ${injected.specPath} (present: ${injected.launchSpecPresent})`,
    `daemon extensions: ${injected.extensions.join(", ") || "none - this build ships no launch spec"}`,
    `mode: ${options.baseline ? "baseline" : "daemon"}`,
  ]
  const selected = options.only === undefined ? undefined : new Set(options.only.split(","))
  const results = options.baseline ? await baselineScenarios(run) : await runScenarios(run, selected)
  const binaryAfter = binaryDigest(bin)
  const provisioned = runtimeVersions(runtime.home)
  if (binaryAfter !== binaryBefore) {
    results.push({
      scenario: "BINARY-STABILITY",
      title: "the binary under test was not replaced while the suite ran",
      status: "fail",
      reason: `${bin} changed during the run (${binaryBefore.slice(0, 12)} -> ${binaryAfter.slice(0, 12)}): every scenario after the swap measured a different build, and only the first provisioned runtime carries the seeded mock provider. Rerun against a binary nobody is rebuilding.`,
      facts: { binaryDigestBefore: binaryBefore, binaryDigestAfter: binaryAfter, runtimeVersionsProvisioned: provisioned },
    })
  }
  // Structural isolation only: QA must not even read the operator's credentials to hash them.
  const addressed = results.flatMap((entry) => entry.receipt?.processesNamingRealAgentDir ?? [])
  const realSenpiUntouched = addressed.length === 0
  const leaked = await sweepRunRoot(runRoot)
  rmSync(runRoot, { recursive: true, force: true })
  const summary = {
    result: results.every((entry) => entry.status !== "fail") ? "PASS" : "FAIL",
    mode: options.baseline ? "baseline" : "daemon",
    binary: bin,
    binaryVersion: runtime.version,
    binaryDigest: binaryBefore,
    binaryDigestStable: binaryAfter === binaryBefore,
    runtimeVersionsProvisioned: provisioned,
    runRoot,
    daemonLaunchSpecPresent: injected.launchSpecPresent,
    daemonLaunchExtensions: injected.extensions,
    realSenpiUntouched,
    realAgentDirNeverAddressed: addressed.length === 0,
    realAgentProcessesNamingRealDir: addressed,
    realAgentFilesRead: false,
    realAgentDirs: REAL_AGENT_DIRS,
    globalModeRpcProcessCount: globalModeRpcCount(),
    runRootProcessesBeforeSweep: leaked.before,
    runRootProcessesAfterSweep: leaked.after,
    runRootRemoved: true,
    counts: countBy(results),
    ...(blockingDefect(results) === undefined ? {} : { blockingDefect: blockingDefect(results) }),
    scenarios: results,
  }
  for (const result of results) {
    writeFileSync(join(out, `task-host-e2e-${result.scenario}.log`), transcript(result, header))
  }
  for (const name of SUMMARY_NAMES) writeFileSync(join(out, name), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify({
    result: summary.result,
    counts: summary.counts,
    out,
    realSenpiUntouched,
    realAgentDirNeverAddressed: summary.realAgentDirNeverAddressed,
  }))
  return summary.result === "PASS" && leaked.after.length === 0 && addressed.length === 0 ? 0 : 1
}

/**
 * The run-level half of the cleanup receipt. A scenario that throws never reaches its own cleanup, so
 * whatever it started is collected here: nothing this driver spawned may outlive it.
 */
async function sweepRunRoot(runRoot) {
  const before = sandboxProcesses({ root: runRoot })
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const entry of sandboxProcesses({ root: runRoot })) {
      try {
        process.kill(entry.pid, signal)
      } catch {
        // already gone
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return { before: before.map((entry) => ({ pid: entry.pid, args: entry.args.slice(0, 200) })), after: sandboxProcesses({ root: runRoot }).map((entry) => entry.pid) }
}

/**
 * When the root-cause probe could not open ONE session the way the host runner does, every daemon
 * scenario downstream is measuring the same single defect; saying so once, at the top of the summary,
 * is what keeps a reader from reading twelve symptoms as twelve problems.
 */
function blockingDefect(results) {
  const probed = results.find((entry) => entry.facts?.rootCause?.opened === false)
  if (probed === undefined) return undefined
  return {
    scenario: probed.scenario,
    surface: "open_session (RpcHostRunner.openChild)",
    error: probed.facts.rootCause.error,
    sessionPath: probed.facts.rootCause.sessionPath,
  }
}

function runtimeVersions(home) {
  const root = join(home, ".omo", "binary-runtime")
  return existsSync(root) ? readdirSync(root) : []
}

function optionalPath(value) {
  return value === undefined ? undefined : resolve(value)
}

function countBy(results) {
  return results.reduce((counts, entry) => ({ ...counts, [entry.status]: (counts[entry.status] ?? 0) + 1 }), { pass: 0, fail: 0, skipped: 0 })
}

async function runScenarios(run, selected) {
  const results = []
  for (const [name, scenario] of SCENARIOS) {
    if (selected !== undefined && !selected.has(name)) continue
    try {
      const produced = await scenario(run)
      results.push(...(Array.isArray(produced) ? produced : [produced]))
      for (const result of Array.isArray(produced) ? produced : [produced]) {
        console.log(`${result.scenario}: ${result.status.toUpperCase()} ${result.reason ?? result.title}`)
      }
    } catch (error) {
      results.push({
        scenario: name,
        title: `scenario ${name}`,
        status: "fail",
        reason: `driver error: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`,
      })
    }
  }
  return results
}

const options = parseArgs(process.argv.slice(2))
if (process.argv.includes("--self-test")) {
  await runSelfTest(scriptDir)
  console.log("SELF-TEST OK")
} else {
  process.exitCode = await main(options)
}
