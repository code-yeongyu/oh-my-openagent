import { join } from "node:path"

import {
  runProcessFamilySweep,
  type ProcessFamilySweepOptions,
  type ProcessFamilySweepResult,
  type ProcessSweepAction,
} from "./family-sweeper"
import { enumerateProcesses } from "./exec"
import {
  OMO_LSP_DAEMON_VERSION_ENV,
  planStaleLspDaemonVersionSweep,
  resolveLspDaemonBaseDir,
  type LspDaemonBaseDirOptions,
  type SparedLspDaemonVersion,
  type StaleLspDaemonVersionTarget,
} from "./lsp-daemon-family"
import { attestLspDaemonOwner } from "./lsp-daemon-owner-attestation"
import { selectOrphanedLspDaemonProxies, type LspDaemonProxyProcess } from "./lsp-proxy-family"
import type { ProcessInfo } from "./process-table"
import { discoverCodegraphOwnedRoots, type CodegraphOwnedRootsOptions } from "./roots"

export {
  sweepCodegraphZombies,
  type CodegraphSweepAction,
  type SweepCodegraphZombiesOptions,
  type SweepCodegraphZombiesResult,
} from "./codegraph-sweeper"
export type {
  ProcessFamilySweepOptions,
  ProcessFamilySweepResult,
  ProcessSweepAction,
} from "./family-sweeper"

export interface SweepOrphanedLspDaemonProxiesOptions
  extends CodegraphOwnedRootsOptions,
    ProcessFamilySweepOptions,
    LspDaemonBaseDirOptions {
  readonly ownedRoots?: readonly string[]
  readonly processProvider?: () => Promise<readonly ProcessInfo[]>
}

export interface SweepOrphanedLspDaemonProxiesResult extends ProcessFamilySweepResult<LspDaemonProxyProcess> {
  readonly ownedRoots: readonly string[]
}

const LSP_PROXY_SWEEP_STAMP_FILE = "lsp-proxy-sweep.stamp"

export async function sweepOrphanedLspDaemonProxies(
  options: SweepOrphanedLspDaemonProxiesOptions = {},
): Promise<SweepOrphanedLspDaemonProxiesResult> {
  const stampFile = join(resolveLspDaemonBaseDir(options), LSP_PROXY_SWEEP_STAMP_FILE)
  const ownedRoots = options.ownedRoots ?? discoverCodegraphOwnedRoots(options)

  const result = await runProcessFamilySweep<LspDaemonProxyProcess>(
    {
      familyLabel: "lsp-daemon proxy sweep",
      stampFile,
      collect: async () => {
        const provider = options.processProvider ?? (() => enumerateProcesses(options.platform))
        const candidates = selectOrphanedLspDaemonProxies(await provider(), {
          ownedRoots,
          ...(options.platform === undefined ? {} : { platform: options.platform }),
        })
        return { candidates, killList: candidates, spared: [] }
      },
    },
    options,
  )
  return { ...result, ownedRoots }
}

export type LspDaemonVersionSweepAction = ProcessSweepAction | "skipped"

export interface SweepStaleLspDaemonVersionsOptions extends ProcessFamilySweepOptions, LspDaemonBaseDirOptions {
  readonly attest?: (pid: number, platform: NodeJS.Platform) => Promise<boolean>
  readonly attestTarget?: (target: StaleLspDaemonVersionTarget, platform: NodeJS.Platform) => Promise<boolean>
  readonly currentVersion?: string
  readonly isAlive?: (pid: number) => boolean
}

export interface SweepStaleLspDaemonVersionsResult
  extends Omit<ProcessFamilySweepResult<StaleLspDaemonVersionTarget, SparedLspDaemonVersion>, "action"> {
  readonly action: LspDaemonVersionSweepAction
  readonly currentVersion?: string
}

const LSP_DAEMON_SWEEP_STAMP_FILE = "lsp-daemon-sweep.stamp"

export async function sweepStaleLspDaemonVersions(
  options: SweepStaleLspDaemonVersionsOptions = {},
): Promise<SweepStaleLspDaemonVersionsResult> {
  const baseDir = resolveLspDaemonBaseDir(options)
  const stampFile = join(baseDir, LSP_DAEMON_SWEEP_STAMP_FILE)
  const currentVersion = resolveCurrentLspDaemonVersion(options)
  const dryRun = options.dryRun === true

  if (currentVersion === undefined) {
    options.log?.("lsp-daemon stale-version sweep skipped: current lsp-daemon version is unknown")
    return { action: "skipped", candidates: [], dryRun, failed: [], killed: [], spared: [], stampFile }
  }

  const platform = options.platform ?? process.platform
  const attestTarget = options.attestTarget
    ?? (options.attest === undefined
      ? (target: StaleLspDaemonVersionTarget) => attestLspDaemonOwner(target)
      : (target: StaleLspDaemonVersionTarget) => options.attest!(target.pid, platform))
  const result = await runProcessFamilySweep<StaleLspDaemonVersionTarget, SparedLspDaemonVersion>({
    attestBeforeSignal: (target) => attestTarget(target, platform),
    familyLabel: "lsp-daemon stale-version sweep",
    stampFile,
    collect: async () => {
      const plan = await planStaleLspDaemonVersionSweep({
        baseDir,
        currentVersion,
        attestTarget,
        ...(options.isAlive === undefined ? {} : { isAlive: options.isAlive }),
        ...(options.log === undefined ? {} : { log: options.log }),
        platform,
      })
      return { candidates: [...plan.targets, ...plan.spared], killList: plan.targets, spared: plan.spared }
    },
  }, options)
  return { ...result, currentVersion }
}

function resolveCurrentLspDaemonVersion(options: SweepStaleLspDaemonVersionsOptions): string | undefined {
  if (options.currentVersion !== undefined && options.currentVersion.trim().length > 0) return options.currentVersion
  const fromEnv = (options.env ?? process.env)[OMO_LSP_DAEMON_VERSION_ENV]
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : undefined
}
