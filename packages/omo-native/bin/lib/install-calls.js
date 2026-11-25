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
import { heldTarget, isLockFailure, LOCK_RETRY_DELAYS_MS } from "./update-lock.js"
import { heldInstall } from "./update-held.js"
import { join } from "node:path"
import { failure } from "./install-result.js"

/**
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/failure.ts").OmoFailure} Failure
 */
/**
 * @template T
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/failure.ts").OmoValue<T>} Result
 */

/** @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").InstallVersion} InstallVersion */

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
 * @param {object} [_input]
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
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").InstallUpdate} InstallUpdate
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
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").InstallFailedDetails} InstallFailedDetails
 * @typedef {InstallFailedDetails["reason"]} InstallFailedReason
 */

/**
 * The exits \`omo update\` ends with, as data in the shape of the omo SDK's exit surfaces ({ ok, refused, rules }, rules
 * tried in order, first match wins; exitFrom passes a details field through when it is an integer 1 to 255). It moves
 * unchanged to omo-sdk/exit/install.ts once slice P1b's exit projection lands. The usage refusal (exit 2) is the
 * parser's, before any call.
 */
export const INSTALL_UPDATE_EXITS = /** @type {const} */ ({
  ok: 0,
  refused: 1,
  rules: [
    { code: "install_failed", details: { reason: "manager_failed" }, exitFrom: "exit_status" },
    { code: "install_failed", details: { reason: "versioned" }, exitFrom: "exit_status" },
  ],
})

/**
 * The exit for a failure under \`surface\`: the first rule whose code and details match, else \`refused\`.
 * @param {typeof INSTALL_UPDATE_EXITS} surface @param {{ code: string, details?: Record<string, unknown> }} [failure]
 * @returns {number}
 */
export function exitOf(surface, failure) {
  if (failure === undefined) return surface.ok
  for (const rule of surface.rules) {
    if (rule.code !== failure.code) continue
    const details = failure.details ?? {}
    if (!Object.entries(rule.details ?? {}).every(([key, value]) => details[key] === value)) continue
    const value = details[rule.exitFrom]
    if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 255) return Number(value)
  }
  return surface.refused
}

/** @type {{ readonly [Kind in Exclude<import("./versioned-install.js").VersionedOutcome["kind"], "updated">]: Extract<InstallFailedDetails, { reason: "versioned" }>["cause"] }} */
const VERSIONED_CAUSE = {
  no_bun: "no_bun",
  busy: "busy",
  install_failed: "bun_install_failed",
  wrong_version: "wrong_version",
  not_on_path: "path_still_old",
}

/** @param {InstallFailedDetails} details @param {string} message @returns {Failure} */
const installFailed = (details, message) => failure("install_failed", message, INSTALL_NEXT, details)

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

  // Loaded here, not at module load: its bun-runtime import claims the private-descriptor table, which an engine boot
  // that imports this module for version or setup must still find (memory-sync-boot-claim.test.ts).
  const { findVersionedInstall, versionedInstallUpdate, versionedUpdateTarget } = await import("./versioned-install.js")
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
      command: resolved.argv,
      command_line: resolved.command,
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
      return installFailed(
        { reason: "engine_missing", before: before.omo, command: resolved.command },
        `omo ${before.omo} is up to date, but its engine files are missing or incomplete`,
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
    return installFailed(
      {
        reason: "versioned",
        cause: VERSIONED_CAUSE[outcome.kind],
        exit_status: outcome.exitCode,
        before: before.omo,
        target,
        versions_dir: versioned.versionsDir,
        current: versioned.current,
        version_dir: versioned.versionDir,
        ...("finalDir" in outcome ? { final_dir: outcome.finalDir } : {}),
        ...("holder" in outcome ? { holder: outcome.holder } : {}),
        ...("reported" in outcome ? { reported: outcome.reported } : {}),
        ...(outcome.kind === "not_on_path"
          ? {
              updated: outcome.updated,
              seen: outcome.seen,
              ...(outcome.onPath === undefined ? {} : { on_path: outcome.onPath, on_path_real: outcome.onPathReal }),
            }
          : {}),
      },
      `the versioned install did not move to ${target}`,
    )
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
    installFailed(
      { reason: "manager_not_started", command: resolved.command },
      "the package manager could not be started",
    )

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
    return installFailed(
      { reason: "file_held", attempts: LOCK_RETRY_DELAYS_MS.length + 1, before: before.omo, ...held },
      "Windows would not let the package manager replace a file",
    )
  }
  if (failed(result)) {
    return installFailed(
      { reason: "manager_failed", exit_status: result.status ?? 1, command: resolved.command },
      "the package manager failed",
    )
  }

  const after = readInstalled()
  if (target !== undefined && after.omo !== target) {
    return installFailed(
      { reason: "not_moved", before: before.omo, after: after.omo, target, command: resolved.command },
      `omo is still ${after.omo}; ${target} is published`,
    )
  }
  return answer("updated", true, { after })
}
