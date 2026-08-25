import { spawnSync } from "node:child_process"
import { existsSync, realpathSync, statSync } from "node:fs"
import { delimiter, join, sep } from "node:path"
import { packageRoot } from "./package-paths.js"

// Upgrading omo-ai does not reach every entry point at once: zsh and bash cache the resolved
// command path per session, and a legacy wrapper left in ~/.local/bin can sit ahead of the npm
// global bin directory. Both keep an old binary serving after a successful upgrade until the user
// clears the cache or repairs PATH order, so diagnostics must surface every competing omo on PATH
// together with the exact recovery commands.

const VERSION_PROBE_TIMEOUT_MS = 2000
const MAX_VERSION_PROBES = 3

function commandCandidates(dir, platform) {
  return platform === "win32" ? [join(dir, "omo.cmd"), join(dir, "omo.exe")] : [join(dir, "omo")]
}

function isExecutableFile(path, platform) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return false
  }
  if (!stat.isFile()) return false
  return platform === "win32" || (stat.mode & 0o111) !== 0
}

/**
 * Every omo command reachable through PATH, in PATH order, duplicates collapsed. Missing
 * directories and non-executable entries are skipped because a shell could not resolve them either.
 */
export function findOmoPathEntries(pathEnv, platform = process.platform) {
  const seen = new Set()
  const entries = []
  for (const dir of String(pathEnv ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const key = platform === "win32" ? dir.toLowerCase() : dir
    if (seen.has(key)) continue
    seen.add(key)
    for (const candidate of commandCandidates(dir, platform)) {
      if (!existsSync(candidate)) continue
      if (!isExecutableFile(candidate, platform)) continue
      entries.push(candidate)
      break
    }
  }
  return entries
}

function realPathOf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function isInsideRoot(path, root) {
  const resolvedPath = realPathOf(path)
  const resolvedRoot = realPathOf(root)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep)
}

/**
 * Runs `<candidate> --version` and returns the first output line. Windows is skipped without
 * spawning: Node refuses .cmd/.exe shims without a shell, and shelling out on attacker-shaped PATH
 * entries is not worth a version string. Any failure degrades to null instead of throwing.
 */
export function readInstalledVersion(binPath, timeoutMs = VERSION_PROBE_TIMEOUT_MS) {
  if (process.platform === "win32") return null
  try {
    const result = spawnSync(binPath, ["--version"], { encoding: "utf8", timeout: timeoutMs, windowsHide: true })
    const line = String(result.stdout ?? "").split("\n")[0]?.trim() ?? ""
    return line.length > 0 ? line : null
  } catch {
    return null
  }
}

/**
 * Classifies the omo commands on PATH against this install. Foreign copies that appear before the
 * first copy belonging to this package shadow it outright; the rest are leftovers a cached shell
 * command may still resolve to.
 */
export function collectStaleOmoBins({
  pathEnv = process.env.PATH,
  platform = process.platform,
  root = packageRoot,
  probeVersion = readInstalledVersion,
} = {}) {
  const entries = findOmoPathEntries(pathEnv, platform)
  const oursIndex = entries.findIndex((entry) => isInsideRoot(entry, root))

  let probes = 0
  const describe = (path) => {
    const version = probes < MAX_VERSION_PROBES && !isInsideRoot(path, root) ? probeVersion(path) : null
    probes += 1
    return { path, version }
  }

  if (oursIndex === -1) {
    return { oursOnPath: false, oursPath: undefined, ahead: entries.map(describe), behind: [] }
  }
  return {
    oursOnPath: true,
    oursPath: entries[oursIndex],
    ahead: entries.slice(0, oursIndex).map(describe),
    behind: entries.slice(oursIndex + 1).map(describe),
  }
}

function formatEntry(entry) {
  return entry.version === null ? `${entry.path} (unknown version)` : `${entry.path} (reports ${entry.version})`
}

function formatList(entries) {
  return entries.map(formatEntry).join(", ")
}

/**
 * Doctor-ready WARN lines describing competing omo commands on PATH and how to invalidate the
 * stale shell command cache. Warnings never fail the run: a leftover binary is an environment
 * hazard, not a broken install artifact.
 */
export function staleBinWarnings(options = {}) {
  const stale = collectStaleOmoBins(options)
  const recovery =
    'refresh the shell command cache after upgrading: hash -r (zsh: rehash); if ~/.local/bin precedes the npm global bin directory, prepend it: export PATH="$(npm prefix -g)/bin:$PATH"'
  if (!stale.oursOnPath) {
    if (stale.ahead.length === 0) return []
    return [
      `WARN omo on PATH is not this install (${options.root ?? packageRoot}): ${formatList(stale.ahead)}`,
      `WARN ${recovery}`,
    ]
  }
  if (stale.ahead.length > 0) {
    return [
      `WARN stale omo binaries run ahead of this install on PATH: ${formatList(stale.ahead)} beats ${stale.oursPath}`,
      `WARN ${recovery}`,
    ]
  }
  if (stale.behind.length > 0) {
    return [
      `WARN other omo copies remain on PATH behind this install: ${formatList(stale.behind)}; a shell that already ran one keeps starting it until its command cache is refreshed: hash -r (zsh: rehash)`,
    ]
  }
  return []
}
