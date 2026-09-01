import { existsSync, realpathSync } from "node:fs"
import { homedir as osHomedir } from "node:os"
import { posix, win32 } from "node:path"
import { propagateResult, runChild } from "./child-process.js"

// A bun global install lives under <BUN_ROOT>/install/global/, and `bun add -g` links the launcher
// into <BUN_ROOT>/bin. The link TARGET is what identifies the install, so every comparison below
// runs on a real path.
const GLOBAL_TREE_MARKER = "/install/global/"

// Both sides of the tree comparison are reduced to one spelling: backslashes become forward
// slashes so Windows paths match, and repeated separators collapse because BUN_INSTALL is
// user-supplied and a value like `/tmp//bunroot` would otherwise never prefix-match a real path.
function normalize(path) {
  return path.replaceAll("\\", "/").replaceAll(/\/{2,}/g, "/")
}

function pathApi(platform) {
  return platform === "win32" ? win32 : posix
}

export function bunRoot(env, homedir, platform) {
  return env.BUN_INSTALL ? env.BUN_INSTALL : pathApi(platform).join(homedir(), ".bun")
}

/**
 * Node resolves the main module to its real path, so the script side of the comparison is already
 * canonical. The root has to be canonicalized too or the two sides can name the same directory in
 * different spellings - `/tmp` against `/private/tmp` on macOS, or any symlinked home - and a real
 * bun install would silently fail to be recognized. A root that does not exist is used verbatim.
 */
function canonicalRoot(env, homedir, platform, realpath) {
  const root = bunRoot(env, homedir, platform)
  try {
    return realpath(root)
  } catch {
    return root
  }
}

function binaryName(platform) {
  return platform === "win32" ? "bun.exe" : "bun"
}

function pathDelimiter(platform) {
  return platform === "win32" ? ";" : ":"
}

/**
 * True when the executed script belongs to a Bun global install. The caller passes the script's
 * REAL path: the launcher is reached through a symlink under the bun root's bin directory, and
 * that link lives outside the global tree, so the link path itself never matches.
 */
export function isUnderBunGlobalTree(scriptRealPath, options = {}) {
  const env = options.env ?? process.env
  const homedir = options.homedir ?? osHomedir
  const platform = options.platform ?? process.platform
  const realpath = options.realpath ?? realpathSync
  const root = normalize(canonicalRoot(env, homedir, platform, realpath)).replace(/\/+$/, "")
  return normalize(scriptRealPath).startsWith(`${root}${GLOBAL_TREE_MARKER}`)
}

function pathExtensions(env, platform) {
  if (platform !== "win32") return [""]
  const configured = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
  return configured.split(";").filter(Boolean)
}

/**
 * Locates the bun binary this machine would run. Absence is a normal answer - a user who installed
 * omo with npm has no bun, and the launcher simply stays on node.
 */
export function findBunBinary(options = {}) {
  const env = options.env ?? process.env
  const homedir = options.homedir ?? osHomedir
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  const paths = pathApi(platform)
  const name = binaryName(platform)

  const candidates = [
    paths.join(bunRoot(env, homedir, platform), "bin", name),
    paths.join(homedir(), ".bun", "bin", name),
  ]
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path")
  const entries = pathKey ? (env[pathKey] ?? "").split(pathDelimiter(platform)).filter(Boolean) : []
  for (const entry of entries) {
    for (const extension of pathExtensions(env, platform)) {
      // On win32 the name already carries .exe; PATHEXT decides which other spellings are runnable.
      const candidate = paths.join(entry, platform === "win32" ? `bun${extension}` : name)
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * The whole policy in one place, first match wins:
 *   1. already on bun            -> stay (the loop guard; without it a re-exec would recurse)
 *   2. OMO_RUNTIME=node          -> stay (explicit user override beats detection)
 *   3. OMO_RUNTIME=bun + bun     -> re-exec
 *   4. bun global install + bun  -> re-exec (the reason this module exists)
 *   5. anything else             -> stay
 */
export function resolveBunReexec(input) {
  const env = input.env ?? process.env
  const versions = input.versions ?? process.versions
  if (versions.bun) return { reexec: false }
  const requested = env.OMO_RUNTIME
  if (requested === "node") return { reexec: false }
  if (requested !== "bun" && !isUnderBunGlobalTree(input.scriptPath, input)) return { reexec: false }
  const bunPath = findBunBinary(input)
  if (!bunPath) return { reexec: false }
  return { reexec: true, bunPath }
}

/**
 * Runs the decision. Resolves true when bun took over the process, in which case the caller must
 * return immediately: the child has already run to completion and its exit status is propagated.
 *
 * The wait is asynchronous for the same reason the engine spawn is: this is the outer half of the
 * launcher chain, and a node process blocked in `spawnSync` here dies to a SIGTERM without ever
 * telling the bun child - which owns the engine - that anything happened.
 *
 * Node's execArgv is deliberately dropped - node flags are not bun flags, and forwarding them
 * would fail the very launch this re-exec is meant to make work.
 */
export async function maybeReexecUnderBun(input) {
  const decision = resolveBunReexec(input)
  if (!decision.reexec) return false
  const run = input.spawn ?? runChild
  const propagate = input.propagate ?? propagateResult
  const argv = input.argv ?? process.argv
  const result = await run(decision.bunPath, [input.scriptPath, ...argv.slice(2)], {
    stdio: "inherit",
    windowsHide: true,
  })
  propagate(result)
  return true
}
