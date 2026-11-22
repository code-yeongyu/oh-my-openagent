import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"
import { findBunBinary } from "./bun-runtime.js"
import { findOmoOnPath, readLauncherVersion, realpathOrSelf, reportsVersion } from "./path-omo.js"
import { liveForeignStages, pruneLeftovers } from "./versioned-leftovers.js"

// A side-by-side install (#12022): `<versions>/<version>/` holds a package.json pinning omo-ai, the bun
// install of it, and optionally an `omo` wrapper naming that dir; `<versions>/current` links the live
// one and PATH reaches omo through `current`. A version dir is live only once it has `.complete`.
const CURRENT = "current"
const WRAPPER = "omo"
const COMPLETE = ".complete"

/**
 * @typedef {{ versionsDir: string, versionDir: string, current: string, manifest: Record<string, unknown> }} VersionedInstall
 * @param {string} root the running omo-ai package root
 * @param {NodeJS.Platform} platform
 * @returns {VersionedInstall | undefined}
 */
export function findVersionedInstall(root, platform) {
  if (platform === "win32") return undefined
  try {
    const packageDir = realpathSync(root)
    if (basename(packageDir) !== "omo-ai" || basename(dirname(packageDir)) !== "node_modules") return undefined
    const versionDir = dirname(dirname(packageDir))
    const versionsDir = dirname(versionDir)
    const current = join(versionsDir, CURRENT)
    if (!lstatSync(current).isSymbolicLink() || dirname(realpathSync(current)) !== versionsDir) return undefined
    const manifest = JSON.parse(readFileSync(join(versionDir, "package.json"), "utf8"))
    if (typeof manifest?.dependencies?.["omo-ai"] !== "string") return undefined
    return { versionsDir, versionDir, current, manifest }
  } catch {
    return undefined
  }
}

/** @param {VersionedInstall} install @param {string} target */
export function versionedUpdateTarget(install, target) {
  return {
    manager: "bun",
    command: `bun install in ${join(install.versionsDir, target)}, then ${install.current} -> ${target}`,
    argv: [],
  }
}

function launcherIn(dir) {
  return existsSync(join(dir, WRAPPER)) ? WRAPPER : join("node_modules", ".bin", "omo")
}

function setAside(versionsDir, dir, target, now) {
  if (existsSync(dir)) renameSync(dir, join(versionsDir, `.failed-${target}-${now()}`))
}

function wrapperFor(dir, bun) {
  const entry = join(dir, "node_modules", "omo-ai", "bin", "omo.js")
  return [
    "#!/bin/sh",
    "# omo versioned launcher: runs this version's own entry so live sessions never share files with a newer one",
    `if [ "$OMO_RUNTIME" != node ] && [ -x '${bun}' ]; then exec '${bun}' '${entry}' "$@"; fi`,
    `exec '${entry}' "$@"`,
    "",
  ].join("\n")
}

async function installInto(input, finalDir, bun) {
  const { install, target, run, env } = input
  const stage = join(install.versionsDir, `.stage-${target}-${process.pid}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage)
  const dependencies = { ...install.manifest.dependencies, "omo-ai": target }
  writeFileSync(join(stage, "package.json"), `${JSON.stringify({ ...install.manifest, dependencies }, null, 2)}\n`)
  let result
  try {
    result = await run(bun, ["install"], { cwd: stage, stdio: "inherit", windowsHide: true, env })
  } catch {
    result = { status: 1, signal: null }
  }
  if (result.signal || (result.status ?? 1) !== 0) {
    rmSync(stage, { recursive: true, force: true })
    return result.status || 1
  }
  if (existsSync(join(install.versionDir, WRAPPER))) {
    writeFileSync(join(stage, WRAPPER), wrapperFor(finalDir, bun), { mode: 0o755 })
  }
  renameSync(stage, finalDir)
  return 0
}

/**
 * Installs omo-ai@<target> beside the running version the way the layout was built, proves the new dir
 * runs, then swaps `current` with one rename. `current` never names a dir that failed either step, and
 * the previous version dir stays for rollback. Exit 0 only when the omo on PATH reports the target.
 * @param {{ install: VersionedInstall, before: string, target: string, run: Function, env: NodeJS.ProcessEnv,
 *   platform: NodeJS.Platform, log: (line: string) => void, error: (line: string) => void, now?: () => number }} input
 * @returns {Promise<number>}
 */
export async function updateVersionedInstall(input) {
  try {
    return await updateInto(input)
  } finally {
    pruneLeftovers(input.install.versionsDir)
  }
}

async function updateInto(input) {
  const { install, before, target, env, platform, log, error } = input
  const now = input.now ?? Date.now
  const { versionsDir, current } = install
  const finalDir = join(versionsDir, target)
  const unchanged = `${current} still points at ${before}`
  const bun = findBunBinary({ env, platform, homedir: () => env.HOME ?? homedir() })
  if (bun === undefined) {
    error(`omo: ${versionsDir} is a bun-managed install, but no bun was found; ${unchanged}`)
    return 1
  }

  const busy = liveForeignStages(versionsDir, target)
  if (busy.length > 0) {
    error(`omo: another installer is updating ${finalDir} (${busy[0]}); retry when it finishes, ${unchanged}`)
    return 1
  }
  // A target dir another writer finished (with or without `.complete`) is adopted when it runs the target.
  const runsTarget = async () =>
    reportsVersion(await readLauncherVersion(join(finalDir, launcherIn(finalDir)), env), target)
  if (!existsSync(finalDir) || !(await runsTarget())) {
    setAside(versionsDir, finalDir, target, now)
    const status = await installInto(input, finalDir, bun)
    if (status !== 0) {
      error(`omo: bun install of omo-ai@${target} into ${finalDir} failed; ${unchanged}`)
      return status
    }
    const fresh = await readLauncherVersion(join(finalDir, launcherIn(finalDir)), env)
    if (!reportsVersion(fresh, target)) {
      setAside(versionsDir, finalDir, target, now)
      error(`omo: the omo installed in ${finalDir} reports "${fresh}", not ${target}; set it aside, ${unchanged}`)
      return 1
    }
  }
  if (!existsSync(join(finalDir, COMPLETE)))
    writeFileSync(join(finalDir, COMPLETE), `${new Date(now()).toISOString()}\n`)

  const next = `${current}.tmp-${process.pid}`
  rmSync(next, { force: true })
  symlinkSync(isAbsolute(readlinkSync(current)) ? finalDir : target, next)
  renameSync(next, current)

  const updated = join(current, launcherIn(finalDir))
  const onPath = findOmoOnPath(env)
  const seen = await readLauncherVersion(onPath ?? updated, env)
  if (reportsVersion(seen, target)) {
    log(`omo ${before} -> ${target} (${finalDir}; ${install.versionDir} is kept for rollback)`)
    return 0
  }
  error(`omo: updated ${versionsDir}: ${current} -> ${target} (${install.versionDir} is kept for rollback)`)
  error(
    onPath === undefined
      ? `omo: but ${updated} reports "${seen}"`
      : `omo: but PATH still resolves the old omo: ${onPath} (${realpathOrSelf(onPath)}) reports "${seen}"; the updated omo is ${updated}: put it first on PATH or remove ${onPath}`,
  )
  return 1
}
