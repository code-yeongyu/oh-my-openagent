import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { codegraphDataRoot } from "./paths"
import { createDefaultCodegraphProcessKiller, enumerateCodegraphProcesses, type CodegraphProcessKiller } from "./process-exec"
import { selectZombieCodegraphProcesses, type CodegraphProcessInfo, type CodegraphZombieProcess } from "./process-match"
import { discoverCodegraphOwnedRoots, type CodegraphOwnedRootsOptions } from "./process-roots"

export type CodegraphSweepAction = "failed" | "swept" | "throttled"

export interface SweepCodegraphZombiesOptions extends CodegraphOwnedRootsOptions {
  readonly dryRun?: boolean
  readonly force?: boolean
  readonly graceMs?: number
  readonly killer?: CodegraphProcessKiller
  readonly log?: (message: string) => void
  readonly nowMs?: number
  readonly ownedRoots?: readonly string[]
  readonly platform?: NodeJS.Platform
  readonly processProvider?: () => Promise<readonly CodegraphProcessInfo[]>
  readonly throttleMs?: number
}

export interface SweepCodegraphZombiesResult {
  readonly action: CodegraphSweepAction
  readonly candidates: readonly CodegraphZombieProcess[]
  readonly dryRun: boolean
  readonly failed: readonly { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[]
  readonly killed: readonly CodegraphZombieProcess[]
  readonly ownedRoots: readonly string[]
  readonly stampFile: string
}

const DEFAULT_GRACE_MS = 2_000
const DEFAULT_THROTTLE_MS = 60 * 60 * 1_000
const SWEEP_STAMP_FILE = "zombie-sweep.stamp"

export async function sweepCodegraphZombies(options: SweepCodegraphZombiesOptions = {}): Promise<SweepCodegraphZombiesResult> {
  const homeDir = options.homeDir ?? options.env?.["HOME"] ?? options.env?.["USERPROFILE"] ?? homedir()
  const stampFile = join(codegraphDataRoot(homeDir), SWEEP_STAMP_FILE)
  const nowMs = options.nowMs ?? Date.now()
  const dryRun = options.dryRun === true
  const ownedRoots = options.ownedRoots ?? discoverCodegraphOwnedRoots(options)

  if (options.force !== true && isSweepThrottled(stampFile, nowMs, options.throttleMs ?? DEFAULT_THROTTLE_MS)) {
    return emptyResult("throttled", dryRun, ownedRoots, stampFile)
  }

  try {
    const provider = options.processProvider ?? (() => enumerateCodegraphProcesses(options.platform))
    const candidates = selectZombieCodegraphProcesses(await provider(), {
      ownedRoots,
      ...(options.platform === undefined ? {} : { platform: options.platform }),
    })
    const result = dryRun
      ? { failed: [], killed: [] }
      : await killCandidates(candidates, options.killer ?? createDefaultCodegraphProcessKiller(options.platform), options)
    if (!dryRun) writeSweepStamp(stampFile, nowMs)
    return { action: "swept", candidates, dryRun, failed: result.failed, killed: result.killed, ownedRoots, stampFile }
  } catch (error) {
    options.log?.(`CodeGraph zombie sweep skipped: ${error instanceof Error ? error.message : String(error)}`)
    return emptyResult("failed", dryRun, ownedRoots, stampFile)
  }
}

async function killCandidates(
  candidates: readonly CodegraphZombieProcess[],
  killer: CodegraphProcessKiller,
  options: SweepCodegraphZombiesOptions,
): Promise<Pick<SweepCodegraphZombiesResult, "failed" | "killed">> {
  const failed: { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[] = []
  const killed: CodegraphZombieProcess[] = []
  for (const candidate of candidates) {
    const terminated = await safelyTerminate(candidate.pid, killer, failed, options.log)
    if (!terminated) continue
    await delay(options.graceMs ?? DEFAULT_GRACE_MS)
    if (!(await killer.isAlive(candidate.pid))) {
      killed.push(candidate)
      continue
    }
    if (await safelyKill(candidate.pid, killer, failed, options.log)) killed.push(candidate)
  }
  return { failed, killed }
}

async function safelyTerminate(
  pid: number,
  killer: CodegraphProcessKiller,
  failed: { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[],
  log: ((message: string) => void) | undefined,
): Promise<boolean> {
  try {
    await killer.terminate(pid)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failed.push({ error: message, pid, stage: "terminate" })
    log?.(`CodeGraph zombie sweep failed to terminate pid ${pid}: ${message}`)
    return false
  }
}

async function safelyKill(
  pid: number,
  killer: CodegraphProcessKiller,
  failed: { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }[],
  log: ((message: string) => void) | undefined,
): Promise<boolean> {
  try {
    await killer.kill(pid)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failed.push({ error: message, pid, stage: "kill" })
    log?.(`CodeGraph zombie sweep failed to kill pid ${pid}: ${message}`)
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

function emptyResult(
  action: CodegraphSweepAction,
  dryRun: boolean,
  ownedRoots: readonly string[],
  stampFile: string,
): SweepCodegraphZombiesResult {
  return { action, candidates: [], dryRun, failed: [], killed: [], ownedRoots, stampFile }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}
