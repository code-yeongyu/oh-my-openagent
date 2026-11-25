// @ts-check
// The install namespace of the omo SDK (first-party design 6.7, slice C1c): each export is one call, takes its input
// and then its ports as one argument with real defaults, and resolves to { kind: "ok", value } or a typed failure.
// Nothing here prints, exits or reads a terminal; the commands render these answers. Plain ESM because the npm
// launcher loads it without a build step.

import { runChild } from "./child-process.js"
import { fetchNpmDistTagsSync } from "./npm-dist-tags.js"
import {
  channelDistTagVersion,
  channelPackageSpec,
  packageManifest,
  packageRoot,
  readJson,
  releaseChannel,
  resolveSenpi,
  updateTarget,
} from "./package-paths.js"
import { findHolders, heldTarget, isLockFailure, listWindowsProcesses, LOCK_RETRY_DELAYS_MS } from "./update-lock.js"
import { findVersionedInstall, versionedInstallUpdate, versionedUpdateTarget } from "./versioned-install.js"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { setupCoverage } from "./category-coverage.js"
import { applySetupStages, collectSetupPlans, scanSetup, setupEntryText, setupStages } from "./setup-stream.js"
import { displayPath, setupSummary } from "./setup-summary.js"

/**
 * @typedef {{ code: string, message: string, next_action: string, details?: Record<string, unknown> }} FailureBody
 * @typedef {{ kind: "error", error: FailureBody }} Failure
 */
/**
 * @template T
 * @typedef {{ kind: "ok", value: T } | Failure} Result
 */

/** @param {string} code @param {string} message @param {string} next_action @param {Record<string, unknown>} [details] @returns {Failure} */
function failure(code, message, next_action, details) {
  return { kind: "error", error: { code, message, next_action, ...(details === undefined ? {} : { details }) } }
}

/**
 * @typedef {{ commit: string, committedAt: string, branch: string }} BuildComponent
 * @typedef {{ command: string, omo: BuildComponent, engine: BuildComponent }} OmoBuild
 * @typedef {{ scheme: "epoch" | "nodef", epoch: number, sha7: string, source: "buildInfo" | "senpi-package" | "omitted" }} EngineBuild
 * @typedef {{ version: string, engine: string, omo_build?: OmoBuild, engine_build?: EngineBuild }} InstallVersion
 */

/** The npm edition's answer: this package's version and the engine it resolved; "unknown" when the engine tree cannot be read. */
export function readInstalledVersion() {
  let engine = "unknown"
  try {
    engine = readJson(join(resolveSenpi().packageRoot, "package.json")).version
  } catch {
    // The product version is still reportable when the engine tree cannot be resolved.
  }
  return { omo: packageManifest().version, engine }
}

/**
 * install.version(): what `omo --version` and `-v` print, as data. The root admits the caller (security design 4.3).
 * @param {Record<string, never>} [_input]
 * @param {{ read?: () => InstallVersion }} [ports]
 * @returns {{ kind: "ok", value: InstallVersion }}
 */
export function version(_input = {}, ports = {}) {
  const read =
    ports.read ??
    (() => {
      const installed = readInstalledVersion()
      return { version: installed.omo, engine: installed.engine }
    })
  return { kind: "ok", value: read() }
}

/**
 * @typedef {{ manager: string, command: string, argv: string[], env?: Record<string, string> }} UpdateTarget
 * @typedef {{ status: number | null, signal: string | null, stderr?: string }} ChildResult
 * @typedef {{ omo: string, engine: string }} Installed
 * @typedef {{ name: string, pid: number }} Holder
 * @typedef {{ kind: "unpinned", channel: string, spec: string }
 *   | { kind: "installing", manager: string, command: string }
 *   | { kind: "retrying", file: string | undefined, delay_ms: number, attempt: number, attempts: number }
 *   | { kind: "held", file: string | undefined, attempts: number, holders: Holder[] }} UpdateProgress
 * @typedef {{
 *   state: "printed" | "up_to_date" | "updated",
 *   version: string,
 *   channel: string,
 *   manager: string,
 *   command: string,
 *   argv: string[],
 *   ran: boolean,
 *   before: Installed,
 *   after?: Installed,
 *   versioned?: { final_dir: string, kept: string },
 * }} InstallUpdate
 * @typedef {{
 *   resolveUpdate?: (targetVersion?: string) => UpdateTarget,
 *   fetchDistTags?: () => Record<string, unknown> | null,
 *   run?: (command: string, args: string[], options?: Record<string, unknown>) => Promise<ChildResult>,
 *   readInstalled?: () => Installed,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   sleep?: (ms: number) => Promise<void>,
 *   listProcesses?: () => import("./update-lock.js").ProcessEntry[],
 *   installDir?: string,
 *   selfPids?: number[],
 *   root?: string,
 *   onProgress?: (event: UpdateProgress) => void,
 * }} UpdatePorts
 */

const INSTALL_NEXT = "Read details.reason, fix what it names, then call install.update again."

/**
 * install.update({ dry_run? }): moves this npm install to the version its channel's dist-tag names, or with dry_run
 * answers the command that would. The root admits the caller (security design 4.3).
 * @param {{ dry_run?: boolean }} [input]
 * @param {UpdatePorts} [ports]
 * @returns {Promise<Result<InstallUpdate>>}
 */
export async function update(input = {}, ports = {}) {
  const unknown = Object.keys(input).find((key) => key !== "dry_run")
  if (unknown !== undefined || (input.dry_run !== undefined && typeof input.dry_run !== "boolean")) {
    return failure(
      "invalid_arguments",
      `install.update does not take ${unknown ?? "this dry_run"}`,
      "Fix the named input and call it again.",
      {
        field: unknown ?? "dry_run",
      },
    )
  }
  const resolveUpdate =
    ports.resolveUpdate ??
    ((targetVersion) => updateTarget(undefined, undefined, undefined, undefined, undefined, targetVersion))
  const fetchDistTags = ports.fetchDistTags ?? fetchNpmDistTagsSync
  const run = ports.run ?? runChild
  const readInstalled = ports.readInstalled ?? readInstalledVersion
  const env = ports.env ?? process.env
  const platform = ports.platform ?? process.platform
  const sleep = ports.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const progress = ports.onProgress ?? (() => {})

  const before = readInstalled()
  const channel = releaseChannel(before.omo)
  const target = channelDistTagVersion(fetchDistTags(), before.omo)
  const versioned = findVersionedInstall(ports.root ?? packageRoot, platform)
  if (versioned !== undefined && target === undefined) {
    return failure(
      "service_unreachable",
      `could not confirm the ${channel} omo-ai version from the npm registry`,
      "Check the network, then retry.",
      { reason: "registry_unconfirmed", channel, versions_dir: versioned.versionsDir },
    )
  }
  const resolved =
    versioned === undefined || target === undefined ? resolveUpdate(target) : versionedUpdateTarget(versioned, target)
  /** @param {InstallUpdate["state"]} state @param {boolean} ran @param {Partial<InstallUpdate>} [extra] @returns {Result<InstallUpdate>} */
  const answer = (state, ran, extra = {}) => ({
    kind: "ok",
    value: {
      state,
      version: target ?? "",
      channel,
      manager: resolved.manager,
      command: resolved.command,
      argv: resolved.argv,
      ran,
      before,
      ...extra,
    },
  })

  if (target === undefined) progress({ kind: "unpinned", channel, spec: channelPackageSpec(before.omo) })
  if (input.dry_run === true) return answer("printed", false)
  if (target !== undefined && target === before.omo) {
    // Already on the target, the update installs nothing, so a broken engine tree needs the reinstall named.
    if (before.engine === "unknown") {
      return failure(
        "install_failed",
        `omo ${before.omo} is up to date, but its engine files are missing or incomplete`,
        INSTALL_NEXT,
        {
          reason: "engine_missing",
          version: before.omo,
          command: resolved.command,
          exit_status: 1,
        },
      )
    }
    return answer("up_to_date", false)
  }
  progress({ kind: "installing", manager: resolved.manager, command: resolved.command })
  if (versioned !== undefined && target !== undefined) {
    const outcome = await versionedInstallUpdate({ install: versioned, before: before.omo, target, run, env, platform })
    if (outcome.kind === "updated") {
      return answer("updated", true, {
        after: { omo: target, engine: before.engine },
        versioned: { final_dir: outcome.finalDir, kept: versioned.versionDir },
      })
    }
    return failure("install_failed", `the versioned install did not move to ${target}`, INSTALL_NEXT, {
      reason: "versioned",
      exit_status: outcome.exitCode,
      outcome,
      install: versioned,
      before: before.omo,
      target,
    })
  }

  /** @param {UpdateTarget} spec */
  const install = async (spec) => {
    const [command, ...argv] = spec.argv
    return run(command, argv, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...env, ...spec.env },
      captureStderr: platform === "win32",
    })
  }
  /** @param {ChildResult} result */
  const failed = (result) => Boolean(result.signal) || (result.status ?? 1) !== 0
  /** @param {ChildResult} result */
  const heldOnWindows = (result) => platform === "win32" && !result.signal && isLockFailure(result.stderr)
  const spawnFailed = () =>
    failure("install_failed", "the package manager could not be started", INSTALL_NEXT, {
      reason: "spawn_failed",
      command: resolved.command,
      exit_status: 1,
    })

  /** @type {ChildResult} */
  let result
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await install(resolved)
    } catch {
      return spawnFailed()
    }
    if (!failed(result) || !heldOnWindows(result) || attempt >= LOCK_RETRY_DELAYS_MS.length) break
    const delay = LOCK_RETRY_DELAYS_MS[attempt]
    progress({
      kind: "retrying",
      file: heldTarget(result.stderr),
      delay_ms: delay,
      attempt: attempt + 2,
      attempts: LOCK_RETRY_DELAYS_MS.length + 1,
    })
    await sleep(delay)
  }

  if (failed(result) && heldOnWindows(result)) {
    const held = await heldInstall({ result, before, install, resolveUpdate, readInstalled, ports, progress })
    return failure("install_failed", "Windows would not let the package manager replace a file", INSTALL_NEXT, {
      reason: "file_held",
      exit_status: 1,
      before: before.omo,
      ...held,
    })
  }
  if (failed(result)) {
    return failure("install_failed", "the package manager failed", INSTALL_NEXT, {
      reason: "manager_failed",
      command: resolved.command,
      exit_status: result.status ?? 1,
    })
  }

  const after = readInstalled()
  if (target !== undefined && after.omo !== target) {
    return failure("install_failed", `omo is still ${after.omo}; ${target} is published`, INSTALL_NEXT, {
      reason: "not_moved",
      installed: after.omo,
      target,
      command: resolved.command,
      exit_status: 1,
    })
  }
  return answer("updated", true, { after })
}

/** @param {() => Installed} readInstalled */
function readInstalledOrUndefined(readInstalled) {
  try {
    return readInstalled()
  } catch {
    return undefined
  }
}

/**
 * On Windows a file the manager could not replace: who holds it, what is installed now, and, only when no install can
 * be read any more, one reinstall of the previous version.
 * @param {{ result: ChildResult, before: Installed, install: (spec: UpdateTarget) => Promise<ChildResult>,
 *   resolveUpdate: (version?: string) => UpdateTarget, readInstalled: () => Installed, ports: UpdatePorts,
 *   progress: (event: UpdateProgress) => void }} input
 */
async function heldInstall({ result, before, install, resolveUpdate, readInstalled, ports, progress }) {
  const file = heldTarget(result.stderr)
  const listProcesses = ports.listProcesses ?? listWindowsProcesses
  const installDir = ports.installDir ?? dirname(packageRoot)
  const selfPids = ports.selfPids ?? [process.pid, process.ppid]
  /** @type {Holder[]} */
  const holders = findHolders(installDir, listProcesses(), selfPids, file).map((holder) => ({
    name: holder.name,
    pid: holder.pid,
  }))
  progress({ kind: "held", file, attempts: LOCK_RETRY_DELAYS_MS.length + 1, holders })
  const now = readInstalledOrUndefined(readInstalled)
  if (now !== undefined) return { file, holders, installed_now: now.omo }
  // Any readable omo is a working install, even when the pinned target is unknown (registry down): the manager can
  // fail moving an old dependency after the new omo-ai is in place, and reinstalling over it would undo a working
  // update and hit the same held file. Only an unreadable install is restored.
  const previous = resolveUpdate(before.omo)
  let restored
  try {
    restored = await install(previous)
  } catch {
    restored = { status: 1, signal: null }
  }
  const after = readInstalledOrUndefined(readInstalled)
  return {
    file,
    holders,
    restored: (restored.status ?? 1) === 0 && !restored.signal && after?.omo === before.omo,
    previous_command: previous.command,
  }
}

/**
 * @typedef {import("./setup-stream.js").SetupEntry & { readonly text: string }} InstallSetupEntry
 * @typedef {import("./setup-stream.js").SetupInventory} InstallSetupInventory
 * @typedef {{ id: string, description: string, present: boolean, pending: number, entries: InstallSetupEntry[] }} InstallSetupStage
 * @typedef {{ inventory: InstallSetupInventory, stages: InstallSetupStage[], summary: ReturnType<typeof setupSummary>,
 *   pending: number, target_roots: string[] }} InstallSetupPlan
 * @typedef {{ id: string, outcome: "applied" | "skipped" | "nothing_pending", entries: InstallSetupEntry[] }} InstallSetupStageApplied
 * @typedef {{ applied: string[], skipped: string[], stages: InstallSetupStageApplied[] }} InstallSetupApplied
 * @typedef {{ home?: string, env?: NodeJS.ProcessEnv, loadCoverageRuntime?: () => Promise<any>,
 *   loadCoverageEngine?: () => Promise<any>, loadModelCatalog?: () => Promise<any>, pluginRoot?: string,
 *   onProgress?: (event: { kind: "notice", text: string }) => void }} SetupPorts
 */

/** The plans each answered SetupPlan stands for; they hold target file bytes, so they never leave this module. */
const HELD_PLANS = new WeakMap()
const FIX_INPUT = "Fix the named input and call it again."

/** @param {SetupPorts} ports */
function setupRuntime(ports) {
  const home = ports.home ?? homedir()
  const env = ports.env ?? process.env
  return { ...ports, home, env, agentDir: canonicalAgentDir(env, home) }
}

/** @param {unknown} error */
function setupFailure(error) {
  return failure("internal_error", "omo setup could not finish", "Read details.cause, fix it, then call it again.", {
    cause: error instanceof Error ? error.message : String(error),
  })
}

/** @param {import("./setup-stream.js").SetupEntry} entry @returns {InstallSetupEntry} */
const withText = (entry) => ({ ...entry, text: setupEntryText(entry) })

/**
 * The directories the whole plan writes into, a directory inside another one folded into it.
 * @param {any} plans @param {string} agentDir @param {string} home @returns {string[]}
 */
function targetRoots(plans, agentDir, home) {
  const choiceDirs = plans.modelChoices.items
    .filter((/** @type {any} */ item) => item.state === "pending")
    .map((/** @type {any} */ item) => dirname(item.target.path))
  const roots = [...new Set([agentDir, ...choiceDirs])]
  const inside = (/** @type {string} */ path, /** @type {string} */ root) =>
    path !== root && !relative(root, path).startsWith("..")
  return roots.filter((path) => !roots.some((root) => inside(path, root))).map((path) => displayPath(path, home))
}

export const setup = {
  /**
   * install.setup.detect(): the harnesses found on this machine and what each holds, read only.
   * @param {Record<string, never>} [_input] @param {SetupPorts} [ports]
   * @returns {Promise<Result<InstallSetupInventory>>}
   */
  async detect(_input = {}, ports = {}) {
    const runtime = setupRuntime(ports)
    try {
      for await (const result of scanSetup(runtime, runtime.agentDir, { includeCustomProviders: true })) {
        if (result.source !== "detect") continue
        if (result.error !== undefined) throw result.error
        return { kind: "ok", value: /** @type {InstallSetupInventory} */ (/** @type {unknown} */ (result.plan)) }
      }
      return { kind: "ok", value: { harnesses: [] } }
    } catch (error) {
      return setupFailure(error)
    }
  },

  /**
   * install.setup.plan(): what `omo setup --dry-run` prints, as data. Nothing is written.
   * @param {Record<string, never>} [_input] @param {SetupPorts} [ports]
   * @returns {Promise<Result<InstallSetupPlan>>}
   */
  async plan(_input = {}, ports = {}) {
    const runtime = setupRuntime(ports)
    const { home, env, agentDir } = runtime
    let collected
    try {
      // The CLI has always carried OpenCode's custom providers; the onboarding RPC leaves them opt-in.
      collected = await collectSetupPlans(scanSetup(runtime, agentDir, { includeCustomProviders: true }))
    } catch (error) {
      return setupFailure(error)
    }
    const { inventory, plans } = collected
    const categories = await setupCoverage({
      agentDir,
      home,
      env,
      plans,
      loadRuntime: ports.loadCoverageRuntime,
      loadEngine: ports.loadCoverageEngine,
    })
    const stages = setupStages(plans).map((stage) => {
      const pending = stage.plan?.pending ?? 0
      return {
        id: stage.id,
        description: pending > 0 ? stage.question(stage.plan) : "",
        present: stage.present,
        pending,
        entries: stage.present ? stage.entries(stage.plan).map(withText) : [],
      }
    })
    /** @type {InstallSetupPlan} */
    const value = {
      inventory,
      stages,
      summary: setupSummary({ home, agentDir, inventory, ...plans, categories }),
      pending: stages.reduce((total, stage) => total + stage.pending, 0),
      target_roots: targetRoots(plans, agentDir, home),
    }
    HELD_PLANS.set(value, plans)
    return { kind: "ok", value }
  },

  /**
   * install.setup.apply({ plan, consent, decide? }): writes what the plan holds. consent "all" applies every pending
   * stage; "each" calls decide once per pending stage, in plan order, before that stage's write.
   * @param {{ plan: InstallSetupPlan, consent: "all" | "each",
   *   decide?: (stage: { id: string, description: string }) => "apply" | "skip" | Promise<"apply" | "skip"> }} input
   * @param {SetupPorts} [ports]
   * @returns {Promise<Result<InstallSetupApplied>>}
   */
  async apply(input, ports = {}) {
    const { plan, consent, decide } = input
    if (consent !== "all" && consent !== "each")
      return failure("invalid_arguments", "consent is all or each", FIX_INPUT, { field: "consent" })
    if (consent === "each" && typeof decide !== "function")
      return failure("invalid_arguments", "consent each needs decide", FIX_INPUT, { field: "decide" })
    const plans = HELD_PLANS.get(plan)
    if (plans === undefined)
      return failure("invalid_arguments", "plan is not one install.setup.plan answered here", FIX_INPUT, {
        field: "plan",
      })
    const progress = ports.onProgress ?? (() => {})
    let applied
    try {
      applied = await applySetupStages(
        plans,
        consent === "all"
          ? () => true
          : async (stage) =>
              (await /** @type {NonNullable<typeof decide>} */ (decide)({
                id: stage.id,
                description: stage.question(stage.plan),
              })) === "apply",
        (text) => progress({ kind: "notice", text }),
      )
    } catch (error) {
      return setupFailure(error)
    }
    const stages = setupStages(plans)
    return {
      kind: "ok",
      value: {
        applied: [...applied],
        skipped: stages
          .filter((stage) => (stage.plan?.pending ?? 0) > 0 && !applied.has(stage.id))
          .map((stage) => stage.id),
        stages: stages
          .filter((stage) => stage.present)
          .map((stage) => {
            const reported = applied.has(stage.id) || stage.plan.pending === 0
            return {
              id: stage.id,
              outcome: applied.has(stage.id) ? "applied" : stage.plan.pending === 0 ? "nothing_pending" : "skipped",
              entries: reported ? stage.countEntries(stage.plan).map(withText) : [],
            }
          }),
      },
    }
  },
}
