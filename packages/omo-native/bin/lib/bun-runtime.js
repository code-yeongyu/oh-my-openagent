import { execFile as nodeExecFile } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { homedir as osHomedir } from "node:os"
import { posix, win32 } from "node:path"
import { propagateResult, runChild } from "./child-process.js"

// A bun global install lives under <BUN_ROOT>/install/global/, and `bun add -g` links the launcher
// into <BUN_ROOT>/bin. The link TARGET is what identifies the install, so every comparison below
// runs on a real path.
const GLOBAL_TREE_MARKER = "/install/global/"

// The oldest bun the engine is known to run on: node:sqlite parity and the worker_threads compat the
// JS eval kernel relies on both landed in 1.4. A bun found lying around on an npm-installed machine
// is only trusted from here up; anything older leaves the launch on node, which always works.
export const BUN_MIN_VERSION = "1.4.0"

// `bun --version` answers in a few milliseconds; a probe that has not answered by now is a broken
// binary, and the launch simply proceeds on node.
const VERSION_PROBE_TIMEOUT_MS = 3_000

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

// Only real executables qualify on win32. npm installs bun as a `bun.cmd` shim next to the real
// binary, and Node refuses to spawn .cmd/.bat files without a shell (spawn EINVAL, CVE-2024-27980),
// so a shim can neither answer the version probe nor host the re-exec. PATHEXT still decides which
// executable spellings exist; batch-file spellings are dropped. Lower-case first, so the path
// returned matches how the file is spelled on disk.
const WIN32_EXECUTABLE_EXTENSIONS = new Set([".exe", ".com"])

function pathExtensions(env, platform) {
  if (platform !== "win32") return [""]
  const configured = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
  const spellings = []
  for (const raw of configured.split(";")) {
    const extension = raw.trim()
    if (!WIN32_EXECUTABLE_EXTENSIONS.has(extension.toLowerCase())) continue
    for (const spelling of [extension.toLowerCase(), extension]) {
      if (!spellings.includes(spelling)) spellings.push(spelling)
    }
  }
  return spellings.length > 0 ? spellings : [...WIN32_EXECUTABLE_EXTENSIONS]
}

/**
 * Locates the bun binary this machine would run. Absence is a normal answer - a machine without bun
 * simply keeps the launcher on node.
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

/** True when a `bun --version` answer is at least BUN_MIN_VERSION; missing or unparseable never is. */
export function bunVersionSatisfies(version) {
  if (typeof version !== "string") return false
  const match = /^(\d+)\.(\d+)/.exec(version)
  if (match === null) return false
  const [floorMajor, floorMinor] = BUN_MIN_VERSION.split(".").map(Number)
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > floorMajor || (major === floorMajor && minor >= floorMinor)
}

/**
 * Asks a bun binary for its version. Every failure - a binary that cannot start, prints nothing, or
 * hangs past the bounded timeout - resolves to undefined, which the decision reads as "not a bun we
 * can trust". Asynchronous like every other spawn in this launcher: nothing here may block the
 * event loop, so a signal arriving mid-probe is still handled.
 */
export function probeBunVersion(bunPath, options = {}) {
  const execFile = options.execFile ?? nodeExecFile
  const env = options.env ?? process.env
  return new Promise((resolve) => {
    try {
      execFile(
        bunPath,
        ["--version"],
        { encoding: "utf8", env, timeout: VERSION_PROBE_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve(undefined)
            return
          }
          const version = String(stdout).trim()
          resolve(version === "" ? undefined : version)
        },
      )
    } catch {
      // Node throws synchronously for a batch file spawned without a shell (spawn EINVAL); that is
      // "not a bun we can trust", never a launcher crash.
      resolve(undefined)
    }
  })
}

/**
 * The whole policy in one place, first match wins:
 *   1. already on bun                  -> stay (the loop guard; without it a re-exec would recurse)
 *   2. OMO_RUNTIME=node                -> stay (explicit user override beats detection)
 *   3. no bun binary anywhere          -> stay (npm-only machines never notice this module)
 *   4. OMO_RUNTIME=bun or a bun global install, bun >= 1.4 -> re-exec (the user chose bun)
 *   5. OMO_RUNTIME=bun or a bun global install, older bun  -> refuse with the upgrade message
 *   6. any other install, bun >= 1.4   -> re-exec (a machine that has bun runs omo on bun)
 *   7. any other install, older bun    -> stay on node silently
 *
 * An explicit choice of bun is never silently swapped for node: the engine needs bun 1.4 (node:sqlite,
 * worker_threads), so an older bun the user picked fails at startup with one actionable line instead of
 * inside an extension (#9563). Rule 1's own floor lives in resolveBunGuard.
 */
export async function resolveBunReexec(input) {
  const env = input.env ?? process.env
  const versions = input.versions ?? process.versions
  if (versions.bun) return resolveBunGuard(input)
  const requested = env.OMO_RUNTIME
  if (requested === "node") return { reexec: false }
  const bunPath = findBunBinary(input)
  if (!bunPath) return { reexec: false }
  const probe = input.bunVersion ?? probeBunVersion
  const version = await probe(bunPath, { env })
  if (bunVersionSatisfies(version)) return { reexec: true, bunPath }
  if (choseBun(input)) return { reexec: false, refuse: bunTooOldMessage(version) }
  return { reexec: false }
}

/** The one line an explicit but too-old bun gets; `omo: ` is prefixed by the bin's catch. */
export function bunTooOldMessage(version) {
  return `OmO needs Bun >= ${BUN_MIN_VERSION} (found ${version || "an unknown version"}); run \`bun upgrade\``
}

/** True when the user picked bun: OMO_RUNTIME=bun, or omo was installed with `bun add -g`. */
function choseBun(input) {
  const env = input.env ?? process.env
  return env.OMO_RUNTIME === "bun" || isUnderBunGlobalTree(input.scriptPath, input)
}

/**
 * Rule 1 with its floor: the process already runs on bun (the POSIX bun-global shim execs bun
 * directly, so this is where `bun add -g` users arrive). A current bun stays. An older bun the user
 * chose fails with the upgrade message. An older bun nobody chose hands the launch to node, marked
 * OMO_RUNTIME=node so node never bounces back; a node that is really bun's own shim does not count,
 * and landing on an old bun with OMO_RUNTIME=node already set is that bounce, so it fails too.
 */
export function resolveBunGuard(input) {
  const env = input.env ?? process.env
  const version = (input.versions ?? process.versions).bun
  if (bunVersionSatisfies(version)) return { reexec: false }
  if (choseBun(input) || env.OMO_RUNTIME === "node") return { reexec: false, refuse: bunTooOldMessage(version) }
  const nodePath = findNodeBinary(input)
  if (!nodePath) return { reexec: false, refuse: bunTooOldMessage(version) }
  return { reexec: true, nodePath }
}

/** A real node on PATH: bun's own `node` shim resolves to the bun executable and is skipped. */
export function findNodeBinary(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  const realpath = options.realpath ?? realpathSync
  const paths = pathApi(platform)
  const name = platform === "win32" ? "node.exe" : "node"
  const real = (path) => {
    try {
      return realpath(path)
    } catch {
      return path
    }
  }
  const bunExecutable = real(options.execPath ?? process.execPath)
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path")
  const entries = pathKey ? (env[pathKey] ?? "").split(pathDelimiter(platform)).filter(Boolean) : []
  for (const entry of entries) {
    const candidate = paths.join(entry, name)
    if (exists(candidate) && real(candidate) !== bunExecutable) return candidate
  }
  return undefined
}

/**
 * Runs the decision. Resolves true when bun took over the process, in which case the caller must
 * return immediately. POSIX replaces the current image; unsupported or failed execve uses the
 * asynchronous child path so signals still reach the engine and its exit status is propagated.
 *
 * Node's execArgv is deliberately dropped - node flags are not bun flags, and forwarding them
 * would fail the very launch this re-exec is meant to make work.
 */
export async function maybeReexecUnderBun(input) {
  const decision = await resolveBunReexec(input)
  if (decision.refuse) throw new Error(decision.refuse)
  if (!decision.reexec) return false
  const run = input.spawn ?? runChild
  const propagate = input.propagate ?? propagateResult
  const argv = input.argv ?? process.argv
  const execve = input.execve === undefined ? process.execve : input.execve
  const target = decision.nodePath ?? decision.bunPath
  // A hand-off to node is pinned there so the node launch never re-execs the old bun again.
  const childEnv = decision.nodePath ? { ...process.env, OMO_RUNTIME: "node" } : process.env
  if ((input.platform ?? process.platform) !== "win32" && typeof execve === "function") {
    try {
      execve(target, [target, input.scriptPath, ...argv.slice(2)], childEnv)
      return true
    } catch {
      // Keep the same inherited environment and signal forwarding if replacement fails.
    }
  }
  const result = await run(target, [input.scriptPath, ...argv.slice(2)], {
    stdio: "inherit",
    windowsHide: true,
    ...(decision.nodePath ? { env: childEnv } : {}),
  })
  propagate(result)
  return true
}
