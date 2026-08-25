import { spawn } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalAgentDir } from "./agent-dir.js"
import { detectedFilePaths } from "./setup-detect.js"

/**
 * The interactive launch hint ("sibling credentials detected") is advisory, and live detection
 * costs a visible slice of the launch path. This module is the synchronous, fail-open read side
 * of a cache the launcher consults instead: `harness-detect-cache.json` inside the canonical agent
 * state directory, fingerprinted over every file detection reads (mtime + size) with a TTL bound.
 * The launcher never writes it - only the detached `setup-detect-refresh.js` child does.
 */

/** Cache filename inside the canonical agent state directory. */
export const CACHE_FILENAME = "harness-detect-cache.json"

/** Bumped whenever the cache shape changes, so old entries read as misses. */
export const CACHE_VERSION = 1

// The fingerprint already covers every file detection reads, so the TTL only bounds how long a
// fingerprint-matched answer survives a change in detection itself (an omo update, node:sqlite
// appearing or vanishing). One background refresh per day is the entire worst case.
export const SETUP_SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000

const REFRESH_SCRIPT = fileURLToPath(new URL("./setup-detect-refresh.js", import.meta.url))

/**
 * [path, mtimeMs, size] for every detection input, missing files as [path, null, null]. The JSON
 * spelling of this array is the cache key: two launches that serialize the same array read the
 * same detection answer.
 */
export function setupDetectInputStats(env = process.env, home = homedir()) {
  return detectedFilePaths(home, env).map((path) => {
    try {
      const stats = statSync(path)
      return [path, Math.round(stats.mtimeMs), stats.size]
    } catch {
      return [path, null, null]
    }
  })
}

/**
 * Synchronous read of the cached setup suggestion. Returns `{ suggestion, fresh }`:
 * - `fresh` is true only when the entry is inside the TTL and its fingerprint matches the current
 *   detection inputs;
 * - `suggestion` is the cached boolean when the entry parsed, otherwise undefined, which callers
 *   treat as no-siblings.
 * Every failure is a miss - a cache must never break, or delay, a launch.
 */
export function readSetupSuggestionCache(env = process.env, home = homedir(), now = Date.now()) {
  const missed = { suggestion: undefined, fresh: false }
  try {
    const path = join(canonicalAgentDir(env, home), CACHE_FILENAME)
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed?.version !== CACHE_VERSION) return missed
    if (typeof parsed.suggestion !== "boolean") return missed
    if (!Array.isArray(parsed.inputs)) return missed
    if (typeof parsed.writtenAt !== "number") return missed
    if (now - parsed.writtenAt > SETUP_SUGGESTION_TTL_MS) return { suggestion: parsed.suggestion, fresh: false }
    const fresh = JSON.stringify(parsed.inputs) === JSON.stringify(setupDetectInputStats(env, home))
    return { suggestion: parsed.suggestion, fresh }
  } catch {
    return missed
  }
}

/**
 * Fire-and-forget cache rebuild: a detached, unref'd child re-running the full live detection and
 * rewriting the cache. Never awaited, never writes from this process, and a failed spawn only
 * means the next stale launch refreshes again.
 */
export function spawnSetupSuggestionRefresh() {
  try {
    const child = spawn(process.execPath, [REFRESH_SCRIPT], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    // A failed spawn reports through an async `error` event, and an unhandled one would take the
    // launcher down mid-launch; absorbing it keeps this best-effort refresh genuinely fail-open.
    child.on("error", () => {})
    child.unref()
  } catch {
    // The refresh is best-effort by contract; nothing about this launch depends on it.
  }
}
