import { appendFileSync, rmSync } from "node:fs"
import { cpus, freemem } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runUninstrumented } from "./ci-test-telemetry-fallback.mjs"
import { writeProfile } from "./ci-test-telemetry-profile.mjs"
import { prepareInstrumentation } from "./ci-test-telemetry-setup.mjs"
import { startSampler } from "./ci-test-sampler.mjs"

export { instrumentArguments } from "./ci-test-telemetry-setup.mjs"

export function descendants(processes, rootPid) {
  const ids = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of processes) {
      if (ids.has(row.parentPid) && !ids.has(row.pid)) {
        ids.add(row.pid)
        changed = true
      }
    }
  }
  return processes.filter((row) => ids.has(row.pid))
}

function cpuCounters() {
  const times = cpus().map((cpu) => cpu.times)
  return {
    idle: times.reduce((sum, time) => sum + time.idle, 0),
    total: times.reduce((sum, time) => sum + Object.values(time).reduce((a, b) => a + b, 0), 0),
  }
}

// Telemetry never decides the outcome: the returned code is always the test command's own exit code.
export async function runTelemetry(directory, invocation, args, workers = "4", { intervalMs = 2000 } = {}) {
  directory = resolve(directory ?? ".")
  let setup
  try {
    setup = prepareInstrumentation(directory, invocation, args, workers)
  } catch (error) {
    return runUninstrumented(directory, invocation, args, error)
  }
  const { prefix, preloads, configPath, preloadOutput, timingsPath, launch } = setup
  const started = performance.now()
  const samples = []
  const errors = []
  const seen = new Map()
  let previous = cpuCounters()
  let observedWorkers = null
  let samplerRow = null
  let child
  try {
    child = Bun.spawn([process.execPath, ...launch], {
      stdin: "inherit", stdout: "pipe", stderr: "pipe",
      env: {
        ...process.env,
        CI_TEST_PRELOAD_OUTPUT: preloadOutput,
        CI_TEST_PRELOAD_MODULES: JSON.stringify(preloads.map((name) => ({
          name, url: pathToFileURL(resolve(name)).href,
        }))),
      },
    })
  } catch (error) {
    rmSync(configPath, { force: true })
    return runUninstrumented(directory, invocation, args, error)
  }
  let sampler = null
  function onFrame(table) {
    const tree = descendants(table, child.pid)
    for (const row of tree) seen.set(`${row.pid}:${row.creationTimeUtc}`, row)
    samplerRow = table.find((row) => row.pid === sampler?.pid) ?? samplerRow
    const current = cpuCounters()
    const delta = current.total - previous.total
    const record = {
      elapsedMs: performance.now() - started,
      cpuPercent: delta > 0 ? 100 * (1 - (current.idle - previous.idle) / delta) : null,
      availableMemoryBytes: freemem(),
      treeRssBytes: tree.reduce((sum, row) => sum + row.rssBytes, 0),
      childProcessCount: tree.filter((row) => row.pid !== child.pid).length,
      samplerPid: sampler?.pid ?? null,
      processes: tree,
    }
    previous = current
    samples.push(record)
    appendFileSync(`${prefix}-samples.jsonl`, `${JSON.stringify(record)}\n`)
  }
  try {
    sampler = startSampler({ intervalMs, onFrame, onError: (stage, error) => errors.push({ stage, type: error.name }) })
  } catch (error) {
    errors.push({ stage: "sampler-start", type: error.name })
  }
  async function pump(stream, sink) {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const chunk of stream) {
      sink.write(chunk)
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) {
        const match = /bun test v.*?\b(\d+)x PARALLEL/.exec(line)
        if (match) observedWorkers = Number(match[1])
        if (line.includes("[ci-profile] preload capture failed:")) errors.push({ stage: "preload", type: "write-failed" })
      }
    }
  }
  const forward = () => child.kill()
  process.once("SIGTERM", forward)
  process.once("SIGINT", forward)
  let exitCode
  try {
    ;[exitCode] = await Promise.all([child.exited, pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)])
  } finally {
    process.removeListener("SIGTERM", forward)
    process.removeListener("SIGINT", forward)
  }
  try {
    await sampler?.stop()
    rmSync(configPath, { force: true })
    writeProfile({
      prefix, timingsPath, preloadOutput, invocation, args, workers, exitCode,
      durationMs: performance.now() - started, observedWorkers, samples, seen, sampler: samplerRow, errors,
    })
  } catch (error) {
    console.warn(`[ci-profile] aggregate capture failed: ${error.name}`)
  }
  return exitCode
}

if (import.meta.main) {
  const [directory, invocation, workers, ...args] = process.argv.slice(2)
  // --preflight proves every collector module loads before the wrapper routes tests through it.
  if (directory !== "--preflight") process.exitCode = await runTelemetry(directory, invocation, args, workers)
}
