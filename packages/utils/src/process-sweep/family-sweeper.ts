import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { createDefaultProcessKiller, type ProcessKiller } from "./exec"

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

type ProcessSweepFailure = { readonly error: string; readonly pid: number; readonly stage: "kill" | "terminate" }

interface KillContext {
  readonly failed: ProcessSweepFailure[]
  readonly familyLabel: string
  readonly killer: ProcessKiller
  readonly log: ((message: string) => void) | undefined
}

export interface FamilySweepConfig<TTarget extends { readonly pid: number }, TSpared extends TTarget = TTarget> {
  readonly attestBeforeSignal?: (target: TTarget) => Promise<boolean>
  readonly familyLabel: string
  readonly stampFile: string
  readonly collect: () => Promise<FamilySweepPlan<TTarget, TSpared>>
}

const DEFAULT_GRACE_MS = 2_000
const DEFAULT_THROTTLE_MS = 60 * 60 * 1_000

export async function runProcessFamilySweep<TTarget extends { readonly pid: number }, TSpared extends TTarget = TTarget>(
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
      : await killTargets(plan.killList, options, config)
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

async function killTargets<TTarget extends { readonly pid: number }>(
  targets: readonly TTarget[],
  options: ProcessFamilySweepOptions,
  config: FamilySweepConfig<TTarget>,
): Promise<Pick<ProcessFamilySweepResult<TTarget>, "failed" | "killed">> {
  const failed: ProcessSweepFailure[] = []
  const killed: TTarget[] = []
  const context: KillContext = {
    failed,
    familyLabel: config.familyLabel,
    killer: options.killer ?? createDefaultProcessKiller(options.platform),
    log: options.log,
  }
  for (const target of targets) {
    if (!(await passesSignalAttestation(target, config.attestBeforeSignal, options.log, "SIGTERM"))) continue
    const terminated = await safelyTerminate(target.pid, context)
    if (!terminated) continue
    await delay(options.graceMs ?? DEFAULT_GRACE_MS)
    if (!(await context.killer.isAlive(target.pid))) {
      killed.push(target)
      continue
    }
    if (!(await passesSignalAttestation(target, config.attestBeforeSignal, options.log, "SIGKILL"))) continue
    if (await safelyKill(target.pid, context)) killed.push(target)
  }
  return { failed, killed }
}

async function passesSignalAttestation<TTarget extends { readonly pid: number }>(
  target: TTarget,
  attest: ((target: TTarget) => Promise<boolean>) | undefined,
  log: ((message: string) => void) | undefined,
  signal: "SIGKILL" | "SIGTERM",
): Promise<boolean> {
  if (attest === undefined) return true
  try {
    const attested = await attest(target)
    if (!attested) log?.(`process sweep sparing pid ${target.pid}: identity changed before ${signal}`)
    return attested
  } catch (error) {
    log?.(`process sweep sparing pid ${target.pid}: identity attestation failed before ${signal}: ${String(error)}`)
    return false
  }
}

async function safelyTerminate(pid: number, context: KillContext): Promise<boolean> {
  try {
    await context.killer.terminate(pid)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    context.failed.push({ error: message, pid, stage: "terminate" })
    context.log?.(`${context.familyLabel} failed to terminate pid ${pid}: ${message}`)
    return false
  }
}

async function safelyKill(pid: number, context: KillContext): Promise<boolean> {
  try {
    await context.killer.kill(pid)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    context.failed.push({ error: message, pid, stage: "kill" })
    context.log?.(`${context.familyLabel} failed to kill pid ${pid}: ${message}`)
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
