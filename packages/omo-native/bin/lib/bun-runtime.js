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
 *   4. OMO_RUNTIME=bun                 -> re-exec (explicit opt-in, no version floor)
 *   5. bun global install              -> re-exec (the bun that installed omo is the bun to run it)
 *   6. any other install, bun >= 1.4   -> re-exec (a machine that has bun runs omo on bun)
 *   7. an older bun                    -> stay
 *
 * Rules 5 and 6 differ only in cost: a bun-global install already proved its bun, so it never pays
 * for the version probe, while an npm, project-local or bunx install probes the discovered binary
 * once per node boot before trusting it.
 */
export async function resolveBunReexec(input) {
  const env = input.env ?? process.env
  const versions = input.versions ?? process.versions
  if (versions.bun) return { reexec: false }
  const requested = env.OMO_RUNTIME
  if (requested === "node") return { reexec: false }
  const bunPath = findBunBinary(input)
  if (!bunPath) return { reexec: false }
  if (requested === "bun" || isUnderBunGlobalTree(input.scriptPath, input)) return { reexec: true, bunPath }
  const probe = input.bunVersion ?? probeBunVersion
  const version = await probe(bunPath, { env })
  if (!bunVersionSatisfies(version)) return { reexec: false }
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
  const decision = await resolveBunReexec(input)
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
