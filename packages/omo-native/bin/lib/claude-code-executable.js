import { existsSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { packageRoot, readJson } from "./package-paths.js"

// The engine's claude-sdk-oauth lane runs the native `claude` binary bundled with the pinned
// @anthropic-ai/claude-agent-sdk. Builds below this floor do not carry the newer Claude model ids:
// 0.3.252 has no `claude-fable-5-1` string, 0.3.257 does. Asking a build for an id it does not know
// fails the query with `stopReason: "error"`, `errorMessage: "unknown"` and zero tokens, which the
// retry fallback then hides by answering from a different model - the user reads a normal-looking
// answer produced by a model they did not select.
export const BUNDLED_SDK_FLOOR = "0.3.257"
// Standalone Claude Code ships the same native binary under a lockstep patch number
// (claude-code 2.1.N carries the claude-agent-sdk 0.3.N build), so this is the same floor.
export const STANDALONE_CLAUDE_CODE_FLOOR = "2.1.257"

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(typeof value === "string" ? value : "")
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isBelow(version, floor) {
  const left = parseVersion(version)
  const right = parseVersion(floor)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index]
  }
  return false
}

function enclosingNodeModules(host) {
  let current = dirname(host)
  while (basename(current) !== "node_modules") {
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return current
}

// Both the nested layout (dependency under the host package) and the hoisted one (host package and
// dependency as siblings of the same node_modules), which is what a global install produces.
function packageManifestPaths(host, name) {
  const segments = [...name.split("/"), "package.json"]
  const nodeModules = enclosingNodeModules(host)
  const paths = [join(host, "node_modules", ...segments)]
  if (nodeModules !== undefined) paths.push(join(nodeModules, ...segments))
  return paths
}

function readVersion(paths, exists, readManifest) {
  for (const path of paths) {
    if (!exists(path)) continue
    const version = readManifest(path).version
    if (typeof version === "string") return { version, path }
  }
  return undefined
}

function binaryFromManifest(manifestPath, manifest, exists) {
  const bin = manifest.bin
  const relative = typeof bin === "string" ? bin : typeof bin?.claude === "string" ? bin.claude : undefined
  const candidates = relative === undefined ? [] : [join(dirname(manifestPath), relative)]
  for (const name of ["claude.exe", "claude"]) candidates.push(join(dirname(manifestPath), "bin", name))
  return candidates.find((candidate) => exists(candidate))
}

/**
 * The `CLAUDE_CODE_EXECUTABLE` value to hand the engine, or `undefined` to leave it alone.
 *
 * Only answers a path when the bundled SDK build is too old to know current Claude model ids AND a
 * newer standalone Claude Code is already installed beside this package. An explicit user value
 * always wins, a bundled build at or above the floor is left untouched, and every failure is
 * fail-open: this is a launcher convenience, never a gate on spawning the engine.
 */
export function claudeCodeExecutableOverride(options = {}) {
  const {
    env = process.env,
    senpiRoot,
    root = packageRoot,
    exists = existsSync,
    readManifest = readJson,
  } = options
  try {
    if (typeof env.CLAUDE_CODE_EXECUTABLE === "string" && env.CLAUDE_CODE_EXECUTABLE.length > 0) return undefined
    if (typeof senpiRoot !== "string") return undefined

    const bundled = readVersion(packageManifestPaths(senpiRoot, "@anthropic-ai/claude-agent-sdk"), exists, readManifest)
    if (bundled === undefined || !isBelow(bundled.version, BUNDLED_SDK_FLOOR)) return undefined

    const standalone = readVersion(packageManifestPaths(root, "@anthropic-ai/claude-code"), exists, readManifest)
    if (standalone === undefined || isBelow(standalone.version, STANDALONE_CLAUDE_CODE_FLOOR)) return undefined

    return binaryFromManifest(standalone.path, readManifest(standalone.path), exists)
  } catch {
    return undefined
  }
}
