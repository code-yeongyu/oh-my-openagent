import { appendFileSync } from "node:fs"

// Dynamic imports preserve the configured preload order and include evaluation cost.
// This module is evaluated afresh for each isolated file, just like the originals.
const output = process.env.CI_TEST_PRELOAD_OUTPUT
const modules = JSON.parse(process.env.CI_TEST_PRELOAD_MODULES)
for (const module of modules) {
  const started = performance.now()
  await import(module.url)
  try {
    appendFileSync(output, `${JSON.stringify({
      pid: process.pid,
      worker: process.env.BUN_TEST_WORKER_ID ?? null,
      module: module.name,
      durationMs: performance.now() - started,
    })}\n`)
  } catch (error) {
    console.warn(`[ci-profile] preload capture failed: ${error.name}`)
  }
}
