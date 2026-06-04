import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { type RuntimeState, RuntimeStateSchema, type TeamSpec } from "../types"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import { atomicWrite, withLock } from "./locks"

const STATE_FILE_NAME = "state.json"
export const STALE_DELETING_TTL_MS = 60_000

const ALLOWED_RUNTIME_TRANSITIONS: Readonly<Record<RuntimeState["status"], ReadonlySet<RuntimeState["status"]>>> = {
  creating: new Set(["active", "failed"]),
  active: new Set(["shutdown_requested", "deleting"]),
  shutdown_requested: new Set(["deleting"]),
  deleting: new Set(["deleted"]),
  deleted: new Set(),
  failed: new Set(),
  orphaned: new Set(),
}

export class RuntimeStateError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = "RuntimeStateError"
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`invalid transition ${from} -> ${to}`)
    this.name = "InvalidTransitionError"
  }
}

function getStatePath(baseDir: string, teamRunId: string): string {
  return path.join(getRuntimeStateDir(baseDir, teamRunId), STATE_FILE_NAME)
}

async function removeRuntimeDirectoryBestEffort(
  baseDir: string,
  teamRunId: string,
  reason: "deleted" | "failed" | "stale_deleting",
): Promise<void> {
  try {
    await rm(getRuntimeStateDir(baseDir, teamRunId), { recursive: true, force: true })
  } catch (error) {
    log("team runtime cleanup failed", {
      event: "team-runtime-cleanup-failed",
      teamRunId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function isDeletingRuntimeStale(baseDir: string, teamRunId: string, now: number): Promise<boolean> {
  try {
    const runtimeStateStat = await stat(getStatePath(baseDir, teamRunId))
    return now - runtimeStateStat.mtimeMs > STALE_DELETING_TTL_MS
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return true
    throw error
  }
}

function serializeRuntimeState(runtimeState: RuntimeState): string {
  const parsedRuntimeState = RuntimeStateSchema.parse(runtimeState)
  return `${JSON.stringify(parsedRuntimeState, null, 2)}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripLegacyRuntimeStateMemberFields(member: unknown): unknown {
  if (!isRecord(member)) {
    return member
  }

  const { delegateTaskCallsUsed: _delegateTaskCallsUsed, ...memberWithoutLegacyFields } = member
  return memberWithoutLegacyFields
}

function stripLegacyRuntimeStateFields(rawState: unknown): unknown {
  if (!isRecord(rawState)) {
    return rawState
  }

  const members = rawState["members"]
  if (!Array.isArray(members)) {
    return rawState
  }

  return {
    ...rawState,
    members: members.map(stripLegacyRuntimeStateMemberFields),
  }
}

function validateRuntimeState(rawState: unknown, teamRunId: string): RuntimeState {
  const parsedRuntimeState = RuntimeStateSchema.safeParse(stripLegacyRuntimeStateFields(rawState))
  if (!parsedRuntimeState.success) {
    throw new RuntimeStateError(
      `runtime state invalid for ${teamRunId}: ${parsedRuntimeState.error.message}`,
      "invalid_runtime_state",
    )
  }

  return parsedRuntimeState.data
}

function isValidTransition(fromStatus: RuntimeState["status"], toStatus: RuntimeState["status"]): boolean {
  if (fromStatus === toStatus) return true
  if (toStatus === "orphaned") return true
  return ALLOWED_RUNTIME_TRANSITIONS[fromStatus].has(toStatus)
}

export async function createRuntimeState(
  spec: TeamSpec,
  leadSessionId: string | undefined,
  specSource: "project" | "user",
  config: TeamModeConfig,
): Promise<RuntimeState> {
  const baseDir = resolveBaseDir(config)
  const teamRunId = randomUUID()
  const runtimeDirectoryPath = getRuntimeStateDir(baseDir, teamRunId)
  const runtimeState = validateRuntimeState({
    version: 1,
    teamRunId,
    teamName: spec.name,
    specSource,
    createdAt: Date.now(),
    status: "creating",
    leadSessionId,
    members: spec.members.map((member) => ({
      name: member.name,
      agentType: spec.leadAgentId === member.name ? "leader" : "general-purpose",
      status: "pending",
      color: member.color,
      worktreePath: member.worktreePath,
      lastInjectedTurnMarker: undefined,
      pendingInjectedMessageIds: [],
    })),
    shutdownRequests: [],
    bounds: {
      maxMembers: config.max_members,
      maxParallelMembers: config.max_parallel_members,
      maxMessagesPerRun: config.max_messages_per_run,
      maxWallClockMinutes: config.max_wall_clock_minutes,
      maxMemberTurns: config.max_member_turns,
    },
  }, teamRunId)

  await mkdir(runtimeDirectoryPath, { recursive: true })
  await atomicWrite(getStatePath(baseDir, teamRunId), serializeRuntimeState(runtimeState))
  return runtimeState
}

export async function loadRuntimeState(teamRunId: string, config: TeamModeConfig): Promise<RuntimeState> {
  const baseDir = resolveBaseDir(config)
  const stateContent = await readFile(getStatePath(baseDir, teamRunId), "utf8")

  try {
    return validateRuntimeState(JSON.parse(stateContent), teamRunId)
  } catch (error) {
    if (error instanceof RuntimeStateError) throw error
    throw new RuntimeStateError(
      `runtime state invalid for ${teamRunId}: ${(error as Error).message}`,
      "invalid_runtime_state",
    )
  }
}

export async function saveRuntimeState(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  const baseDir = resolveBaseDir(config)
  await atomicWrite(getStatePath(baseDir, runtimeState.teamRunId), serializeRuntimeState(runtimeState))
}

export async function transitionRuntimeState(
  teamRunId: string,
  transition: (runtimeState: RuntimeState) => RuntimeState,
  config: TeamModeConfig,
): Promise<RuntimeState> {
  const baseDir = resolveBaseDir(config)
  const runtimeDirectoryPath = getRuntimeStateDir(baseDir, teamRunId)

  return withLock(path.join(runtimeDirectoryPath, "state.lock"), async () => {
    const currentRuntimeState = await loadRuntimeState(teamRunId, config)
    const nextRuntimeState = validateRuntimeState(transition(currentRuntimeState), teamRunId)

    if (!isValidTransition(currentRuntimeState.status, nextRuntimeState.status)) {
      throw new InvalidTransitionError(currentRuntimeState.status, nextRuntimeState.status)
    }

    await saveRuntimeState(nextRuntimeState, config)
    return nextRuntimeState
  }, { ownerTag: "team-state-store" })
}

export async function listActiveTeams(
  config: TeamModeConfig,
): Promise<Array<{ teamRunId: string; teamName: string; status: string; memberCount: number; scope: "project" | "user" }>> {
  const baseDir = resolveBaseDir(config)
  const now = Date.now()

  try {
    const runtimeEntries = await readdir(path.join(baseDir, "runtime"), { withFileTypes: true })
    const activeTeams: Array<{ teamRunId: string; teamName: string; status: string; memberCount: number; scope: "project" | "user" }> = []

    for (const runtimeEntry of runtimeEntries) {
      if (!runtimeEntry.isDirectory()) continue

      try {
        const runtimeState = await loadRuntimeState(runtimeEntry.name, config)

        if (runtimeState.status === "deleted" || runtimeState.status === "failed") {
          await removeRuntimeDirectoryBestEffort(baseDir, runtimeEntry.name, runtimeState.status)
          continue
        }

        if (runtimeState.status === "deleting" && await isDeletingRuntimeStale(baseDir, runtimeEntry.name, now)) {
          await removeRuntimeDirectoryBestEffort(baseDir, runtimeEntry.name, "stale_deleting")
          continue
        }

        activeTeams.push({
          teamRunId: runtimeState.teamRunId,
          teamName: runtimeState.teamName,
          status: runtimeState.status,
          memberCount: runtimeState.members.length,
          scope: runtimeState.specSource,
        })
      } catch (error) {
        log("team runtime state skipped", {
          event: "team-runtime-state-skipped",
          teamRunId: runtimeEntry.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    activeTeams.sort((leftTeam, rightTeam) => leftTeam.teamName.localeCompare(rightTeam.teamName) || leftTeam.teamRunId.localeCompare(rightTeam.teamRunId))
    return activeTeams
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return []
    throw error
  }
}
