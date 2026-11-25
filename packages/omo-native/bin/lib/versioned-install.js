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
  const outcome = await versionedInstallUpdate(input)
  const lines = versionedUpdateLines(outcome, input)
  for (const line of lines.log) input.log(line)
  for (const line of lines.error) input.error(line)
  return outcome.exitCode
}

/**
 * The same update as data: what happened and the facts its report names, with nothing printed.
 * @param {{ install: VersionedInstall, before: string, target: string, run: Function, env: NodeJS.ProcessEnv,
 *   platform: NodeJS.Platform, now?: () => number }} input
 * @returns {Promise<VersionedOutcome>}
 */
export async function versionedInstallUpdate(input) {
  try {
    return await updateInto(input)
  } finally {
    pruneLeftovers(input.install.versionsDir)
  }
}

/**
 * @typedef {{ exitCode: number } & (
 *   | { kind: "updated", finalDir: string }
 *   | { kind: "no_bun" }
 *   | { kind: "busy", finalDir: string, holder: string }
 *   | { kind: "install_failed", finalDir: string }
 *   | { kind: "wrong_version", finalDir: string, reported: string }
 *   | { kind: "not_on_path", updated: string, onPath: string | undefined, onPathReal: string | undefined, seen: string }
 * )} VersionedOutcome
 */

/**
 * @param {VersionedOutcome} outcome
 * @param {{ install: VersionedInstall, before: string, target: string }} input
 * @returns {{ log: string[], error: string[] }}
 */
export function versionedUpdateLines(outcome, input) {
  const { install, before, target } = input
  const { versionsDir, current } = install
  const unchanged = `${current} still points at ${before}`
  switch (outcome.kind) {
    case "updated":
      return {
        log: [`omo ${before} -> ${target} (${outcome.finalDir}; ${install.versionDir} is kept for rollback)`],
        error: [],
      }
    case "no_bun":
      return { log: [], error: [`omo: ${versionsDir} is a bun-managed install, but no bun was found; ${unchanged}`] }
    case "busy":
      return {
        log: [],
        error: [
          `omo: another installer is updating ${outcome.finalDir} (${outcome.holder}); retry when it finishes, ${unchanged}`,
        ],
      }
    case "install_failed":
      return { log: [], error: [`omo: bun install of omo-ai@${target} into ${outcome.finalDir} failed; ${unchanged}`] }
    case "wrong_version":
      return {
        log: [],
        error: [
          `omo: the omo installed in ${outcome.finalDir} reports "${outcome.reported}", not ${target}; set it aside, ${unchanged}`,
        ],
      }
    case "not_on_path":
      return {
        log: [],
        error: [
          `omo: updated ${versionsDir}: ${current} -> ${target} (${install.versionDir} is kept for rollback)`,
          outcome.onPath === undefined
            ? `omo: but ${outcome.updated} reports "${outcome.seen}"`
            : `omo: but PATH still resolves the old omo: ${outcome.onPath} (${outcome.onPathReal}) reports "${outcome.seen}"; the updated omo is ${outcome.updated}: put it first on PATH or remove ${outcome.onPath}`,
        ],
      }
  }
}

/** @returns {Promise<VersionedOutcome>} */
async function updateInto(input) {
  const { install, target, env, platform } = input
  const now = input.now ?? Date.now
  const { versionsDir, current } = install
  const finalDir = join(versionsDir, target)
  const bun = findBunBinary({ env, platform, homedir: () => env.HOME ?? homedir() })
  if (bun === undefined) return { kind: "no_bun", exitCode: 1 }

  const busy = liveForeignStages(versionsDir, target)
  if (busy.length > 0) return { kind: "busy", finalDir, holder: busy[0], exitCode: 1 }
  // A target dir another writer finished (with or without `.complete`) is adopted when it runs the target.
  const runsTarget = async () =>
    reportsVersion(await readLauncherVersion(join(finalDir, launcherIn(finalDir)), env), target)
  if (!existsSync(finalDir) || !(await runsTarget())) {
    setAside(versionsDir, finalDir, target, now)
    const status = await installInto(input, finalDir, bun)
    if (status !== 0) return { kind: "install_failed", finalDir, exitCode: status }
    const fresh = await readLauncherVersion(join(finalDir, launcherIn(finalDir)), env)
    if (!reportsVersion(fresh, target)) {
      setAside(versionsDir, finalDir, target, now)
      return { kind: "wrong_version", finalDir, reported: fresh, exitCode: 1 }
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
  if (reportsVersion(seen, target)) return { kind: "updated", finalDir, exitCode: 0 }
  return {
    kind: "not_on_path",
    updated,
    onPath,
    onPathReal: onPath === undefined ? undefined : realpathOrSelf(onPath),
    seen,
    exitCode: 1,
  }
}
