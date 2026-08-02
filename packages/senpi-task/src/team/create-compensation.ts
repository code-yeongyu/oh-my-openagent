import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { TaskLifecycle } from "../lifecycle"
import type { TaskStatus } from "../state"
import type { StateDirConfig } from "../store"
import type { TeamRuntimeManagerPort } from "./runtime-types"
import { memberTaskName } from "./spawn-members"
import { teamStorageBaseDir } from "./storage"

export type CreateCompensationMap = Readonly<Record<string, string>>

type CreateCompensationDeps = {
  readonly manager: Pick<TeamRuntimeManagerPort, "cancelTask" | "get">
  readonly destruction?: Pick<TaskLifecycle, "destroyResidentTask">
  readonly stateDir: StateDirConfig
  readonly writeCreateCompensation?: typeof writeCreateCompensation
  readonly beforeClear?: () => Promise<void>
}

export type CreateCompensationResult = {
  readonly pending: CreateCompensationMap
  readonly errors: readonly Error[]
}

const COMPENSATION_DIR = "create-compensation"
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["completed", "error", "cancelled", "interrupted", "lost"])

function compensationDir(stateDir: StateDirConfig): string {
  return join(teamStorageBaseDir(stateDir), COMPENSATION_DIR)
}

function compensationPath(stateDir: StateDirConfig, teamRunId: string): string {
  return join(compensationDir(stateDir), `${teamRunId}.json`)
}

export async function readCreateCompensation(
  stateDir: StateDirConfig,
  teamRunId: string,
): Promise<CreateCompensationMap> {
  try {
    const parsed: unknown = JSON.parse(await readFile(compensationPath(stateDir, teamRunId), "utf8"))
    return isStringRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function listCreateCompensations(
  stateDir: StateDirConfig,
): Promise<readonly { readonly teamRunId: string; readonly members: CreateCompensationMap }[]> {
  try {
    const entries = await readdir(compensationDir(stateDir), { withFileTypes: true })
    const journals = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const teamRunId = entry.name.slice(0, -".json".length)
        return { teamRunId, members: await readCreateCompensation(stateDir, teamRunId) }
      }))
    return journals.filter((journal) => Object.keys(journal.members).length > 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

export async function writeCreateCompensation(
  stateDir: StateDirConfig,
  teamRunId: string,
  members: CreateCompensationMap,
): Promise<void> {
  const target = compensationPath(stateDir, teamRunId)
  if (Object.keys(members).length === 0) {
    await rm(target, { force: true })
    return
  }
  await mkdir(compensationDir(stateDir), { recursive: true, mode: 0o700 })
  const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(members, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(tempPath, target)
}

export async function compensateCreateMembers(
  teamRunId: string,
  discoveredMembers: CreateCompensationMap,
  deps: CreateCompensationDeps,
): Promise<CreateCompensationResult> {
  const pending: Record<string, string> = {
    ...await readCreateCompensation(deps.stateDir, teamRunId),
    ...discoveredMembers,
  }
  const persist = deps.writeCreateCompensation ?? writeCreateCompensation
  await persist(deps.stateDir, teamRunId, pending)
  const errors: Error[] = []

  for (const [memberName, taskId] of Object.entries(pending)) {
    const record = deps.manager.get(taskId)
    if (record === undefined || record.name !== memberTaskName(teamRunId, memberName)) {
      if (Object.keys(pending).length === 1) await deps.beforeClear?.()
      delete pending[memberName]
      await persist(deps.stateDir, teamRunId, pending)
      continue
    }
    try {
      const outcome = await deps.manager.cancelTask(taskId, `team ${teamRunId} create compensation`)
      if (!await verifyCompensatedTask(taskId, outcome, deps)) continue
      if (Object.keys(pending).length === 1) await deps.beforeClear?.()
      delete pending[memberName]
      await persist(deps.stateDir, teamRunId, pending)
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { pending, errors }
}

async function verifyCompensatedTask(
  taskId: string,
  outcome: Awaited<ReturnType<TeamRuntimeManagerPort["cancelTask"]>>,
  deps: CreateCompensationDeps,
): Promise<boolean> {
  if (outcome.kind === "not_found") return true
  if (outcome.kind === "noop" && !TERMINAL_TASK_STATUSES.has(outcome.status)) return false
  let current = deps.manager.get(taskId)
  if (current === undefined || current.residency_state !== "resident") return true
  if (deps.destruction === undefined) return false
  await deps.destruction.destroyResidentTask(taskId, "cancel")
  current = deps.manager.get(taskId)
  return current === undefined || current.residency_state !== "resident"
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string")
}
