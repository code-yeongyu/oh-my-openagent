// One host-wide pass over every memory identity (DESIGN.r2 6b, H4 of the #10144/#11976 review): the
// backlog sits mostly on identities no session will bind again, so `omo doctor --fix` (unbounded) and
// a bound session's maintenance pass (bounded) walk the same sorted identity list from one persisted
// cursor, under one lock, and each identity is the unit of work. Steps are supplied by the caller so
// retention (#12479) and the size cap (#10144) can join this pass without a second cursor.

import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "../fs/resilient"
import { LockContentionError, withLock } from "../locks/acquire"
import { createLockRecord } from "../locks/lock-record"

export const HOST_SWEEP_STATE_FILE = "runtime-sweep.json"
export const HOST_SWEEP_LOCK_FILE = "runtime-sweep.lock"

export interface HostSweepState {
  readonly version: 1
  readonly cursor?: string
  readonly completedAt?: string
}

export interface HostSweepIdentity {
  readonly name: string
  readonly root: string
  readonly runtimeDir: string
  readonly hasRepo: boolean
}

export type HostSweepStep = (identity: HostSweepIdentity) => Promise<readonly string[]>

export interface HostSweepOptions {
  readonly memoryRoot: string
  readonly steps: readonly HostSweepStep[]
  /** Halt after this many identities (the bounded driver); absent means every identity once. */
  readonly maxIdentities?: number
  /** Halt once this much time has passed (checked between identities). */
  readonly budgetMs?: number
  readonly now?: () => number
  readonly signal?: AbortSignal
  /** Walk and run the steps, but never write the cursor. */
  readonly dryRun?: boolean
}

export type HostSweepResult =
  | { readonly status: "busy" }
  | {
      readonly status: "swept"
      readonly visited: readonly string[]
      readonly completed: boolean
      readonly lines: readonly string[]
    }

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (status) => status.isDirectory(),
    () => false,
  )
}

/** Every `agents/<id>` that has a `runtime/`, repo or not, in sorted order. */
async function listRuntimeIdentities(memoryRoot: string): Promise<readonly HostSweepIdentity[]> {
  const agentsRoot = join(memoryRoot, "agents")
  let names: string[]
  try {
    names = (await readdir(agentsRoot)).filter((name) => !name.startsWith(".")).sort()
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw error
  }
  const identities: HostSweepIdentity[] = []
  for (const name of names) {
    const root = join(agentsRoot, name)
    const runtimeDir = join(root, "runtime")
    if (!(await isDirectory(runtimeDir))) continue
    identities.push({ name, root, runtimeDir, hasRepo: await isDirectory(join(root, "repo")) })
  }
  return identities
}

export async function readHostSweepState(memoryRoot: string): Promise<HostSweepState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(memoryRoot, HOST_SWEEP_STATE_FILE), "utf8"))
    const fields = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
    return {
      version: 1,
      ...(typeof fields.cursor === "string" ? { cursor: fields.cursor } : {}),
      ...(typeof fields.completedAt === "string" ? { completedAt: fields.completedAt } : {}),
    }
  } catch {
    return { version: 1 }
  }
}

async function writeHostSweepState(memoryRoot: string, state: HostSweepState): Promise<void> {
  await mkdir(memoryRoot, { recursive: true, mode: 0o700 })
  const target = join(memoryRoot, HOST_SWEEP_STATE_FILE)
  const temporary = `${target}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

// The identities still to visit in this round (after the cursor), and, for an unbounded driver, the ones
// before it too, so `omo doctor --fix` covers every identity in one run.
function resumeOrder(
  identities: readonly HostSweepIdentity[],
  cursor: string | undefined,
  unbounded: boolean,
): { readonly rest: readonly HostSweepIdentity[]; readonly wrap: readonly HostSweepIdentity[] } {
  if (cursor === undefined) return { rest: identities, wrap: [] }
  const rest = identities.filter((identity) => identity.name > cursor)
  return { rest, wrap: unbounded ? identities.filter((identity) => identity.name <= cursor) : [] }
}

/**
 * Visits identities from the persisted cursor under `runtime-sweep.lock` (never waits: a second driver
 * skips). The cursor is persisted after every identity, so an interrupted pass resumes where it stopped;
 * reaching the end of the sorted list records `completedAt` and clears the cursor (the round is done).
 */
export async function sweepHostIdentities(options: HostSweepOptions): Promise<HostSweepResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const record = await createLockRecord("runtime-sweep")
  try {
    return await withLock(
      join(options.memoryRoot, HOST_SWEEP_LOCK_FILE),
      record,
      async () => {
        const state = await readHostSweepState(options.memoryRoot)
        const unbounded = options.maxIdentities === undefined && options.budgetMs === undefined
        const { rest, wrap } = resumeOrder(await listRuntimeIdentities(options.memoryRoot), state.cursor, unbounded)
        const visited: string[] = []
        const lines: string[] = []
        const visit = async (identity: HostSweepIdentity): Promise<boolean> => {
          if (options.signal?.aborted === true) return false
          if (options.maxIdentities !== undefined && visited.length >= options.maxIdentities) return false
          if (options.budgetMs !== undefined && visited.length > 0 && now() - startedAt >= options.budgetMs)
            return false
          for (const step of options.steps) lines.push(...(await step(identity)))
          visited.push(identity.name)
          return true
        }
        let reachedEnd = true
        for (const identity of rest) {
          if (!(await visit(identity))) {
            reachedEnd = false
            break
          }
          if (options.dryRun !== true)
            await writeHostSweepState(options.memoryRoot, { version: 1, cursor: identity.name })
        }
        if (reachedEnd && options.dryRun !== true)
          await writeHostSweepState(options.memoryRoot, { version: 1, completedAt: new Date(now()).toISOString() })
        if (reachedEnd) for (const identity of wrap) if (!(await visit(identity))) break
        return { status: "swept", visited, completed: reachedEnd, lines }
      },
      { waitTimeoutMs: 0 },
    )
  } catch (error) {
    if (error instanceof LockContentionError) return { status: "busy" }
    throw error
  }
}
