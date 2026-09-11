// Transient one-shot identity runs (issue #7765).
//
// The durable agents root belongs to identities that own a `repo/`. A one-shot run - headless
// `senpi -p`, `--mode json`, a senpi-task rpc child - binds an identity that usually owns nothing,
// and it used to leave a permanent `<memory>/agents/<id>` directory holding runtime scratch only:
// no reader, no prune path, and every guard construction enumerated the whole pile. Such a run is
// routed to `<memory>/transient-runs/<token>/agents/<id>` instead, and that run root is removed
// when the run ends.
//
// `repo/` is the ONLY discriminator, here and in transient-sweep.ts. A transient run that did
// persist memory (a facts or reflection commit created `repo/`) is never deleted: run end leaves
// it in place and the sweep promotes it into the durable agents root once no detached child can
// still be writing into it.

import { existsSync, rm } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { REPO_DIRNAME, buildIdentityPaths, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"
import { OMO_SENPI_TASK_RPC_CHILD } from "@oh-my-opencode/senpi-task"

export const TRANSIENT_DIRNAME = "transient-runs"

/** `<base36 epoch>-<pid>-<random>`; the pid lets the sweep spare a run whose owner is still alive. */
const RUN_TOKEN_PATTERN = /^[0-9a-z]+-(\d+)-[0-9a-z]+$/

export type TransientWarn = (message: string, fields?: Readonly<Record<string, unknown>>) => void

export interface IdentityRunPaths {
  /** Paths the run actually uses: the durable identity paths, or a transient mirror of them. */
  readonly paths: MemoryIdentityPaths
  /** `<memory>/agents/<id>`, whether or not this run writes there. */
  readonly durableRoot: string
  /** Present only for a transient run; removed when the run ends without having persisted memory. */
  readonly transientRunRoot?: string
}

export interface ResolveIdentityRunPathsInput {
  readonly identity: string
  readonly identityPaths: MemoryIdentityPaths
  readonly memoryRoot: string
  readonly oneShot: boolean
  readonly runToken?: () => string
  readonly exists?: (path: string) => boolean
}

/**
 * - durable: the run used the durable identity paths; nothing to reclaim.
 * - removed: the transient run root held no memory and is gone.
 * - kept: the transient run root grew a `repo/`; the sweep promotes it later.
 */
export type IdentityRunDisposition = "durable" | "removed" | "kept"

/**
 * A run is one-shot when no human can ever type into it: a headless surface (`senpi -p`,
 * `--mode json`) or a senpi-task rpc child. An unknown surface counts as interactive, so the
 * durable path stays the default.
 */
export function isOneShotSurface(input: {
  readonly hasUI?: unknown
  readonly env: Record<string, string | undefined>
}): boolean {
  if (input.env[OMO_SENPI_TASK_RPC_CHILD] === "1") return true
  return input.hasUI === false
}

/** The discriminator: an identity is durable exactly when it owns a `repo/`. */
export function isDurableIdentityRoot(root: string, exists: (path: string) => boolean = existsSync): boolean {
  return exists(join(root, REPO_DIRNAME))
}

export function readRunTokenPid(token: string): number | undefined {
  const pid = RUN_TOKEN_PATTERN.exec(token)?.[1]
  return pid === undefined ? undefined : Number(pid)
}

export function resolveIdentityRunPaths(input: ResolveIdentityRunPathsInput): IdentityRunPaths {
  const durableRoot = input.identityPaths.root
  if (!input.oneShot || isDurableIdentityRoot(durableRoot, input.exists)) {
    return { paths: input.identityPaths, durableRoot }
  }
  const token = (input.runToken ?? defaultRunToken)()
  const transientRunRoot = join(input.memoryRoot, TRANSIENT_DIRNAME, token)
  return { paths: buildIdentityPaths(transientRunRoot, input.identity), durableRoot, transientRunRoot }
}

/**
 * Run-end reclaim. Nothing is created here: a transient run that never wrote leaves no directory
 * to remove, and a durable run is untouched. A transient root that holds a `repo/` is deliberately
 * NOT moved here: a reflection or dream child launched by the shutdown drain may still be writing
 * into it, and renaming a tree under a detached child is the one way this path could lose memory.
 */
export async function finalizeIdentityRun(input: {
  readonly run: IdentityRunPaths
  readonly warn?: TransientWarn
}): Promise<IdentityRunDisposition> {
  const runRoot = input.run.transientRunRoot
  if (runRoot === undefined) return "durable"
  if (isDurableIdentityRoot(input.run.paths.root)) return "kept"
  await removeMemoryTree(runRoot, input.warn)
  return "removed"
}

export async function removeMemoryTree(path: string, warn?: TransientWarn): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true })
    return true
  } catch (error) {
    warn?.("omo-senpi memory transient run cleanup failed", { path, error: describe(error) })
    return false
  }
}

function defaultRunToken(): string {
  return `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
