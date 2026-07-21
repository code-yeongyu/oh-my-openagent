import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { codegraphDataRoot } from "../codegraph/paths"
import { evaluateDaemonStaleness } from "../codegraph/daemon-lock"
import { selectZombieCodegraphProcesses, type CodegraphZombieProcess } from "./codegraph-family"
import {
  createDefaultProcessKiller,
  enumerateProcesses,
  type ProcessKiller,
} from "./exec"
import {
  OMO_LSP_DAEMON_VERSION_ENV,
  planStaleLspDaemonVersionSweep,
  resolveLspDaemonBaseDir,
  type LspDaemonBaseDirOptions,
  type SparedLspDaemonVersion,
  type StaleLspDaemonVersionTarget,
} from "./lsp-daemon-family"
import { selectOrphanedLspDaemonProxies, type LspDaemonProxyProcess } from "./lsp-proxy-family"
import type { ProcessInfo } from "./process-table"
import { discoverCodegraphOwnedRoots, type CodegraphOwnedRootsOptions } from "./roots"

export type ProcessSweepAction = "failed" | "swept" | "throttled"

export interface ProcessFamilySweepOptions {
  readonly dryRun?: boolean
  readonly force?: boolean
  readonly graceMs?: number
  readonly killer?: ProcessKiller
  readonly log?: (message: string) => void
  readonly nowMs?: number
  readonly platform?: NodeJS.Platform
  readonly throttleMs?: number
}

export interface ProcessFamilySweepResult<TTarget extends { readonly pid: number }, TSpared extends TTarget = TTarget> {
  readonly action: ProcessSweepAction
  readonly candidates: readonly TTarget[]
  readonly dryRun: boolean
  readonly failed: readonly { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[]
  readonly killed: readonly TTarget[]
  readonly spared: readonly TSpared[]
  readonly stampFile: string
}

interface FamilySweepPlan<TTarget extends { readonly pid: number }, TSpared extends TTarget = TTarget> {
  readonly candidates: readonly TTarget[]
  readonly killList: readonly TTarget[]
  readonly spared: readonly TSpared[]
}

interface FamilySweepConfig<TTarget extends { readonly pid: number }, TSpared extends TTarget = TTarget> {
  readonly familyLabel: string
  readonly stampFile: string
  readonly collect: () => Promise<FamilySweepPlan<TTarget, TSpared>>
}

const DEFAULT_GRACE_MS = 2_000
const DEFAULT_THROTTLE_MS = 60 * 60 * 1_000

/**
 * Generic family sweep engine: throttle per-family stamp -> collect the
 * family's kill plan -> terminate/grace/kill escalation -> refresh the stamp.
 * Families only supply the stamp file and the plan; kill semantics are
 * identical everywhere.
 */
async function runProcessFamilySweep<TTarget extends { readonly pid: number }, TSpared extends TTarget = TTarget>(
  config: FamilySweepConfig<TTarget, TSpared>,
  options: ProcessFamilySweepOptions,
): Promise<ProcessFamilySweepResult<TTarget, TSpared>> {
  const nowMs = options.nowMs ?? Date.now()
  const dryRun = options.dryRun === true

  if (options.force !== true && isSweepThrottled(config.stampFile, nowMs, options.throttleMs ?? DEFAULT_THROTTLE_MS)) {
    return { action: "throttled", candidates: [], dryRun, failed: [], killed: [], spared: [], stampFile: config.stampFile }
  }

  try {
    const plan = await config.collect()
    const { failed, killed } = dryRun
      ? { failed: [], killed: [] }
      : await killTargets(
          plan.killList,
          options.killer ?? createDefaultProcessKiller(options.platform),
          options,
          config.familyLabel,
        )
    if (!dryRun) writeSweepStamp(config.stampFile, nowMs)
    return {
      action: "swept",
      candidates: plan.candidates,
      dryRun,
      failed,
      killed,
      spared: plan.spared,
      stampFile: config.stampFile,
    }
  } catch (error) {
    options.log?.(`${config.familyLabel} skipped: ${error instanceof Error ? error.message : String(error)}`)
    return { action: "failed", candidates: [], dryRun, failed: [], killed: [], spared: [], stampFile: config.stampFile }
  }
}

// ---------------------------------------------------------------------------
// codegraph family (the original zombie sweep; stamp name kept for compat)
// ---------------------------------------------------------------------------

export type CodegraphSweepAction = ProcessSweepAction

export interface SweepCodegraphZombiesOptions extends CodegraphOwnedRootsOptions, ProcessFamilySweepOptions {
  readonly ownedRoots?: readonly string[]
  readonly processProvider?: () => Promise<readonly ProcessInfo[]>
}

export interface SweepCodegraphZombiesResult extends ProcessFamilySweepResult<CodegraphZombieProcess> {
  readonly ownedRoots: readonly string[]
}

const CODEGRAPH_SWEEP_STAMP_FILE = "zombie-sweep.stamp"

export async function sweepCodegraphZombies(options: SweepCodegraphZombiesOptions = {}): Promise<SweepCodegraphZombiesResult> {
  const homeDir = options.homeDir ?? options.env?.["HOME"] ?? options.env?.["USERPROFILE"] ?? homedir()
  const stampFile = join(codegraphDataRoot(homeDir), CODEGRAPH_SWEEP_STAMP_FILE)
  const ownedRoots = options.ownedRoots ?? discoverCodegraphOwnedRoots(options)

  const result = await runProcessFamilySweep<CodegraphZombieProcess>(
    {
      familyLabel: "CodeGraph zombie sweep",
      stampFile,
      collect: async () => {
        const provider = options.processProvider ?? (() => enumerateProcesses(options.platform))
        const candidates = selectZombieCodegraphProcesses(await provider(), {
          ownedRoots,
          ...(options.platform === undefined ? {} : { platform: options.platform }),
        })
        const { killList, spared } = partitionByDaemonStaleness(candidates, options.log)
        return { candidates, killList, spared }
      },
    },
    options,
  )
  return { ...result, ownedRoots }
}

/**
 * Daemon-shaped candidates (`codegraph serve --mcp --path <root>`, detached
 * with ppid 1 BY DESIGN) are exempt from the plain orphan rule: they are
 * swept only when provably stale via the daemon pid lockfile. When staleness
 * cannot be proven the daemon is spared and logged — a wrong call here kills
 * a live shared daemon. (T6 daemon exemption, unchanged.)
 */
function partitionByDaemonStaleness(
  candidates: readonly CodegraphZombieProcess[],
  log: ((message: string) => void) | undefined,
): { readonly killList: readonly CodegraphZombieProcess[]; readonly spared: readonly CodegraphZombieProcess[] } {
  const killList: CodegraphZombieProcess[] = []
  const spared: CodegraphZombieProcess[] = []
  for (const candidate of candidates) {
    if (candidate.matchKind !== "upstream-daemon") {
      killList.push(candidate)
      continue
    }
    const staleness = evaluateDaemonStaleness(candidate.pid, candidate.daemonProjectRoot ?? candidate.matchedRoot)
    if (staleness.stale) {
      log?.(`CodeGraph zombie sweep sweeping stale daemon pid ${candidate.pid} (${staleness.reason})`)
      killList.push(candidate)
      continue
    }
    log?.(`CodeGraph zombie sweep spared live daemon pid ${candidate.pid} (${staleness.reason})`)
    spared.push(candidate)
  }
  return { killList, spared }
}

// ---------------------------------------------------------------------------
// lsp-daemon mcp proxy family
// ---------------------------------------------------------------------------

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
        // Live-parent proxies never reach the candidate list (#5902
        // conservatism pin); every candidate is a plain orphan, no gate.
        return { candidates, killList: candidates, spared: [] }
      },
    },
    options,
  )
  return { ...result, ownedRoots }
}

// ---------------------------------------------------------------------------
// stale old-version lsp-daemon family
// ---------------------------------------------------------------------------

export type LspDaemonVersionSweepAction = ProcessSweepAction | "skipped"

export interface SweepStaleLspDaemonVersionsOptions extends ProcessFamilySweepOptions, LspDaemonBaseDirOptions {
  readonly attest?: (pid: number, platform: NodeJS.Platform) => Promise<boolean>
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

  // Conservatism: without a known current version NO daemon can be proven
  // stale, so the family skips instead of guessing.
  if (currentVersion === undefined) {
    options.log?.("lsp-daemon stale-version sweep skipped: current lsp-daemon version is unknown")
    return { action: "skipped", candidates: [], dryRun, failed: [], killed: [], spared: [], stampFile }
  }

  const result = await runProcessFamilySweep<StaleLspDaemonVersionTarget, SparedLspDaemonVersion>({
    familyLabel: "lsp-daemon stale-version sweep",
    stampFile,
    collect: async () => {
      const plan = await planStaleLspDaemonVersionSweep({
        baseDir,
        currentVersion,
        ...(options.attest === undefined ? {} : { attest: options.attest }),
        ...(options.isAlive === undefined ? {} : { isAlive: options.isAlive }),
        ...(options.log === undefined ? {} : { log: options.log }),
        ...(options.platform === undefined ? {} : { platform: options.platform }),
      })
      return { candidates: [...plan.targets, ...plan.spared], killList: plan.targets, spared: plan.spared }
    },
  },
  options,
  )
  return { ...result, currentVersion }
}

function resolveCurrentLspDaemonVersion(options: SweepStaleLspDaemonVersionsOptions): string | undefined {
  if (options.currentVersion !== undefined && options.currentVersion.trim().length > 0) return options.currentVersion
  const fromEnv = (options.env ?? process.env)[OMO_LSP_DAEMON_VERSION_ENV]
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : undefined
}

// ---------------------------------------------------------------------------
// shared kill/throttle helpers
// ---------------------------------------------------------------------------

async function killTargets<TTarget extends { readonly pid: number }>(
  targets: readonly TTarget[],
  killer: ProcessKiller,
  options: ProcessFamilySweepOptions,
  familyLabel: string,
): Promise<Pick<ProcessFamilySweepResult<TTarget>, "failed" | "killed">> {
  const failed: { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[] = []
  const killed: TTarget[] = []
  for (const target of targets) {
    const terminated = await safelyTerminate(target.pid, killer, failed, options.log, familyLabel)
    if (!terminated) continue
    await delay(options.graceMs ?? DEFAULT_GRACE_MS)
    if (!(await killer.isAlive(target.pid))) {
      killed.push(target)
      continue
    }
    if (await safelyKill(target.pid, killer, failed, options.log, familyLabel)) killed.push(target)
  }
  return { failed, killed }
}

async function safelyTerminate(
  pid: number,
  killer: ProcessKiller,
  failed: { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[],
  log: ((message: string) => void) | undefined,
  familyLabel: string,
): Promise<boolean> {
  try {
    await killer.terminate(pid)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failed.push({ error: message, pid, stage: "terminate" })
    log?.(`${familyLabel} failed to terminate pid ${pid}: ${message}`)
    return false
  }
}

async function safelyKill(
  pid: number,
  killer: ProcessKiller,
  failed: { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[],
  log: ((message: string) => void) | undefined,
  familyLabel: string,
): Promise<boolean> {
  try {
    await killer.kill(pid)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failed.push({ error: message, pid, stage: "kill" })
    log?.(`${familyLabel} failed to kill pid ${pid}: ${message}`)
    return false
  }
}

function isSweepThrottled(stampFile: string, nowMs: number, throttleMs: number): boolean {
  if (!existsSync(stampFile)) return false
  return nowMs - statSync(stampFile).mtimeMs < throttleMs
}

function writeSweepStamp(stampFile: string, nowMs: number): void {
  mkdirSync(dirname(stampFile), { recursive: true })
  writeFileSync(stampFile, `${new Date(nowMs).toISOString()}\n`)
  const stampDate = new Date(nowMs)
  utimesSync(stampFile, stampDate, stampDate)
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}
