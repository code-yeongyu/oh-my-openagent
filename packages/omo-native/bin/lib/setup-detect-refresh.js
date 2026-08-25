/**
 * Detached refresh child for the setup-suggestion cache. Spawned (never awaited) by
 * setup-detect-cache.js when the launcher's synchronous read comes back stale or missing. This is
 * the only writer of the cache: it re-runs the FULL live detection - the same code path the setup
 * and doctor commands run - and atomically rewrites `harness-detect-cache.json` in the canonical
 * agent state directory. Every failure is silent (stdio is ignored by the spawner): a lost refresh
 * only means the next launch refreshes again, and nothing here can ever break a launch.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { CACHE_FILENAME, CACHE_VERSION, setupDetectInputStats } from "./setup-detect-cache.js"
import { detectHarnesses, needsSetupSuggestion } from "./setup-detect.js"

try {
  const home = homedir()
  const env = process.env
  const inventory = await detectHarnesses({ home, env })
  const path = join(canonicalAgentDir(env, home), CACHE_FILENAME)
  const temporary = `${path}.tmp-${process.pid}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temporary, `${JSON.stringify({
    version: CACHE_VERSION,
    writtenAt: Date.now(),
    inputs: setupDetectInputStats(env, home),
    suggestion: needsSetupSuggestion(inventory),
  })}\n`)
  renameSync(temporary, path)
} catch {
  // Fail-open by contract: see the module comment.
}
