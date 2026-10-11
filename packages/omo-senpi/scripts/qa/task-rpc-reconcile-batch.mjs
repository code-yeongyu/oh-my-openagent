#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  captureChild, captureCommand, dumpRunProcesses, RECONCILE_WATCHDOG_MS, runProcesses, sampleFseventsd, withinDeadline,
} from "./task-rpc-diagnostics.mjs"

const script = fileURLToPath(import.meta.url)

export async function runOne(repo, label, outDir, bun) {
  const root = mkdtempSync(join(tmpdir(), "omo9715-ab-"))
  const logPath = join(outDir, `${label}.log`)
  const receipt = { label, repo, root, bun, watchdogMs: RECONCILE_WATCHDOG_MS, cpu: [], stages: [], verdict: "FAIL" }
  const samples = []
  const sample = (stage) => {
    const pending = sampleFseventsd().then((cpu) => {
      receipt.cpu.push({ stage, at: new Date().toISOString(), ...cpu })
    })
    samples.push(pending)
    return pending
  }
  await sample("start")
  const child = spawn(bun.path, [script, "--worker", repo, "--run-root", root], {
    cwd: repo, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, TMPDIR: root, PI_OFFLINE: "1", OMO_SENPI_QA: "1", OMO_QA_BUN_BIN: bun.path,
      OMO_RECONCILE_STAGES: "1",
      BUN_INSTALL_CACHE_DIR: join(root, "bun-cache"),
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "transpiler-cache"),
      NODE_COMPILE_CACHE: join(root, "node-cache"), XDG_CACHE_HOME: join(root, "cache"),
    },
  })
  receipt.driverPid = child.pid
  const capture = captureChild(child)
  let middleSampled = false
  const stdout = createInterface({ input: child.stdout })
  const stderr = createInterface({ input: child.stderr })
  stdout.on("line", (line) => {
    appendFileSync(logPath, line + "\n")
    if (line.startsWith("OMO_RECONCILE_RESULT ")) receipt.report = JSON.parse(line.slice(21))
  })
  stderr.on("line", (line) => {
    appendFileSync(logPath, line + "\n")
    if (!line.startsWith("OMO_RECONCILE_STAGE ")) return
    const stage = JSON.parse(line.slice(20))
    receipt.stages.push(stage)
    console.log(JSON.stringify({ label, ...stage }))
    if (stage.stage === "relaunch_started" && !middleSampled) {
      middleSampled = true
      void sample("middle")
    }
  })
  const started = performance.now()
  try {
    receipt.exit = await withinDeadline(capture.closed, RECONCILE_WATCHDOG_MS, async () => {
      receipt.watchdogDump = await dumpRunProcesses([child.pid], root)
      receipt.stageAtKill = receipt.stages.at(-1)?.stage ?? "driver_start"
      receipt.output = capture.snapshot()
      const parentOutput = join(root, "parents.json")
      if (existsSync(parentOutput)) receipt.parentOutput = JSON.parse(readFileSync(parentOutput, "utf8"))
      writeFileSync(join(outDir, `${label}-watchdog.json`), JSON.stringify(receipt, null, 2) + "\n")
      console.error(`OMO_RECONCILE_WATCHDOG ${JSON.stringify({ label, lastStage: receipt.stages.at(-1)?.stage, dump: receipt.watchdogDump })}`)
      for (const row of await runProcesses([child.pid], root)) {
        try { process.kill(row.pid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
      }
    })
    receipt.verdict = receipt.exit.status === 0 && receipt.report?.verdict === "PASS" ? "PASS" : "FAIL"
  } catch (error) {
    receipt.error = String(error)
  } finally {
    receipt.elapsedMs = performance.now() - started
    if (!middleSampled) await sample("middle_unreached")
    await sample("end")
    await Promise.all(samples)
    const leftovers = await runProcesses([child.pid], root)
    receipt.cleanupPids = leftovers.map((row) => row.pid)
    for (const row of leftovers) {
      try { process.kill(row.pid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
    }
    await capture.closed
    receipt.residualProcesses = await runProcesses([child.pid], root)
    const parentOutput = join(root, "parents.json")
    if (existsSync(parentOutput)) receipt.parentOutput = JSON.parse(readFileSync(parentOutput, "utf8"))
    stdout.close()
    stderr.close()
    rmSync(root, { recursive: true, force: true })
    receipt.directoryRemoved = !existsSync(root)
    if (receipt.residualProcesses.length > 0 || !receipt.directoryRemoved) receipt.verdict = "FAIL"
    writeFileSync(join(outDir, `${label}.json`), JSON.stringify(receipt, null, 2) + "\n")
  }
  return receipt
}

export function summarizeRuns(results) {
  return ["A", "B"].map((variant) => {
    const runs = results.filter((result) => result.label.startsWith(variant))
    const timings = runs.map((run) => run.elapsedMs)
    const cpu = runs.flatMap((run) => run.cpu.flatMap((sample) => sample.values))
    return {
      variant, runs: runs.length, passed: runs.filter((run) => run.verdict === "PASS").length,
      minMs: timings.length ? Math.min(...timings) : null,
      maxMs: timings.length ? Math.max(...timings) : null,
      fseventsdMinCpu: cpu.length ? Math.min(...cpu) : null,
      fseventsdMaxCpu: cpu.length ? Math.max(...cpu) : null,
      stageMinMs: Object.fromEntries([...new Set(runs.flatMap((run) => run.stages.map((stage) => stage.stage)))]
        .map((name) => [name, Math.min(...runs.flatMap((run) => run.stages.filter((stage) => stage.stage === name).map((stage) => stage.durationMs)))])),
    }
  })
}

async function main(args) {
  if (args[0] === "--worker") {
    const repo = resolve(args[1])
    const { runReconcileCheck } = await import(pathToFileURL(join(repo, "packages/omo-senpi/scripts/qa/task-rpc-e2e-scenarios.mjs")).href)
    const result = await runReconcileCheck(join(repo, "node_modules/.bin/senpi"), {
      onOutput: (snapshots) => {
        const path = join(args[3], "parents.json")
        writeFileSync(path + ".tmp", JSON.stringify(snapshots))
        renameSync(path + ".tmp", path)
      },
    })
    console.log("OMO_RECONCILE_RESULT " + JSON.stringify(result))
    if (result.verdict !== "PASS") process.exitCode = 1
    return
  }
  const [a, b, pairsText, out, bunPath] = args
  const pairs = Number(pairsText)
  if (!a || !b || !out || !bunPath || !isAbsolute(bunPath) || !Number.isInteger(pairs) || pairs < 1) {
    throw new Error("usage: task-rpc-reconcile-batch.mjs <suspect-repo> <control-repo> <pairs> <evidence-dir> <absolute-bun-path>")
  }
  const path = realpathSync(bunPath)
  if (!process.versions.bun || realpathSync(process.execPath) !== path) throw new Error("invoke this runner with the same explicitly pinned Bun executable")
  const version = await captureCommand(path, ["--version"])
  if (version.error !== null) throw new Error(version.error)
  const bun = { requestedPath: bunPath, path, version: version.stdout.trim() }
  console.log("OMO_RECONCILE_BUN " + JSON.stringify(bun))
  if (process.platform === "win32") throw new Error("comparison runner requires POSIX ps/lsof")
  const outDir = resolve(out)
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (let pair = 1; pair <= pairs; pair++) {
    for (const [variant, repo] of [["A", a], ["B", b]]) {
      const result = await runOne(resolve(repo), `${variant}${pair}`, outDir, bun)
      results.push(result)
      console.log(`OMO_RECONCILE_RUN ${JSON.stringify({ label: result.label, verdict: result.verdict, elapsedMs: result.elapsedMs, cleanup: result.residualProcesses })}`)
      if (result.residualProcesses.length > 0) throw new Error("cleanup failed; refusing to start another run")
    }
  }
  const summary = summarizeRuns(results)
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ results, summary }, null, 2) + "\n")
  console.log("OMO_RECONCILE_SUMMARY " + JSON.stringify(summary))
  if (results.some((result) => result.verdict !== "PASS")) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === script) await main(process.argv.slice(2))
