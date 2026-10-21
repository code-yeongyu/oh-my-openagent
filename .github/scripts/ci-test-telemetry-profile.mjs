import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { cpus, totalmem } from "node:os"

// Aggregates one profiled invocation into <prefix>-profile.json and the job summary.
export function writeProfile({ prefix, timingsPath, preloadOutput, invocation, args, workers, exitCode, durationMs,
  observedWorkers, samples, seen, sampler, errors }) {
  function capture(stage, action) {
    try {
      return action()
    } catch (error) {
      errors.push({ stage, type: error.name })
      console.warn(`[ci-profile] ${stage} capture failed: ${error.name}`)
      return null
    }
  }
  const files = existsSync(timingsPath)
    ? capture("file-timings", () => JSON.parse(readFileSync(timingsPath, "utf8")).files) : null
  const preloads = capture("preload", () => readFileSync(preloadOutput, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)) ?? []
  const payload = {
    schemaVersion: 1, sha: process.env.CI_TEST_SHA ?? process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    shard: process.env.WINDOWS_TEST_SHARD ?? null, invocation, fallback: false,
    configuredWorkers: args.includes("--parallel") ? Number(workers) : 1,
    observedWorkers, availableCpus: cpus().length, totalMemoryBytes: totalmem(),
    durationMs, exitCode, files,
    preloadEvaluations: preloads.length,
    preloadTotalMs: preloads.reduce((sum, row) => sum + row.durationMs, 0),
    peakChildProcesses: Math.max(0, ...samples.map((row) => row.childProcessCount)),
    peakTreeRssBytes: Math.max(0, ...samples.map((row) => row.treeRssBytes)),
    peakCpuPercent: samples.length ? Math.max(...samples.map((row) => row.cpuPercent ?? 0)) : null,
    minimumAvailableMemoryBytes: samples.length ? Math.min(...samples.map((row) => row.availableMemoryBytes)) : null,
    // The sampler's own last-seen row: its overhead (cumulative CPU time on Windows) is part of the record.
    samplerProcess: sampler,
    sampleCount: samples.length, processInventory: [...seen.values()], errors,
  }
  capture("profile", () => writeFileSync(`${prefix}-profile.json`, `${JSON.stringify(payload, null, 2)}\n`))
  if (!process.env.GITHUB_STEP_SUMMARY) return
  const slowest = Object.entries(files ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 10)
  capture("summary", () => appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `\n### Shard profile: ${invocation}`,
    `SHA: \`${payload.sha}\`; workers configured/observed: ${payload.configuredWorkers}/${observedWorkers ?? "not reported"}; CPUs: ${payload.availableCpus}.`,
    `Exit: ${exitCode}; wall: ${durationMs.toFixed(0)} ms; samples: ${samples.length}; capture errors: ${errors.length}.`,
    `Peak descendants: ${payload.peakChildProcesses}; peak tree RSS: ${payload.peakTreeRssBytes} bytes.`,
    `Peak host CPU: ${payload.peakCpuPercent ?? "unavailable"}%; minimum available memory: ${payload.minimumAvailableMemoryBytes ?? "unavailable"} bytes.`,
    `Sampler CPU time: ${sampler?.cpuTimeMs ?? "unavailable"} ms (one long-lived probe process).`,
    `Preload imports: ${preloads.length}; summed evaluation time: ${payload.preloadTotalMs.toFixed(0)} ms (overlaps across workers).`,
    `Runner per-file timings: ${files === null ? "missing (incomplete/crashed run)" : `${Object.keys(files).length} files`}.`,
    "| Slowest file (runner wall time) | ms |", "| --- | ---: |",
    ...slowest.map(([name, ms]) => `| \`${name.replaceAll("|", "\\|")}\` | ${ms} |`),
    "\nCPU/available-memory time series and creation-qualified process inventory are in the artifact; sampling can miss short-lived children.\n",
  ].join("\n")))
}
