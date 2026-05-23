import { rm, stat } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { ackMessages } from "../team-mailbox/ack"
import { reclaimStaleReservations } from "../team-mailbox/reservation"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import type { RuntimeState, RuntimeStateMember } from "../types"
import { listActiveTeams, loadRuntimeState, transitionRuntimeState } from "./store"

const CREATING_TIMEOUT_MS = 30 * 60 * 1000
const STALE_RESERVATION_TTL_MS = 10 * 60 * 1000

export interface ResumeReport {
  resumed: number
  marked_failed: number
  marked_orphaned: number
  cleaned: number
  errors: Error[]
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined
  return typeof error.message === "string" ? error.message : undefined
}

function extractErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined
  return typeof error.status === "number" ? error.status : undefined
}

function isSessionNotFoundError(error: unknown): boolean {
  if (extractErrorStatus(error) === 404) return true
  const message = extractErrorMessage(error)?.toLowerCase()
  if (!message) return false
  return message.includes("not found") || message.includes("missing")
}

async function runtimeDirectoryExists(teamRunId: string, config: TeamModeConfig): Promise<boolean> {
  try {
    await stat(getRuntimeStateDir(resolveBaseDir(config), teamRunId))
    return true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return false
    throw error
  }
}

async function removeRuntimeDirectory(teamRunId: string, config: TeamModeConfig): Promise<boolean> {
  if (!(await runtimeDirectoryExists(teamRunId, config))) return false
  await rm(getRuntimeStateDir(resolveBaseDir(config), teamRunId), { recursive: true, force: true })
  return true
}

async function cleanupMemberWorktrees(runtimeState: RuntimeState): Promise<void> {
  await Promise.all(runtimeState.members.map(async (member) => {
    if (!member.worktreePath) return
    await rm(member.worktreePath, { recursive: true, force: true })
  }))
}

async function sessionExists(
  ctx: ExecutorContext,
  sessionId: string,
): Promise<boolean> {
  try {
    const response = await ctx.client.session.get({ path: { id: sessionId } })

    if (response.error != null) {
      if (isSessionNotFoundError(response.error)) return false
      throw toError(response.error)
    }

    return response.data != null
  } catch (error) {
    if (isSessionNotFoundError(error)) return false
    throw error
  }
}

function isCreatingStateStuck(runtimeState: RuntimeState, now: number): boolean {
  return runtimeState.status === "creating" && now - runtimeState.createdAt > CREATING_TIMEOUT_MS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getMessagesData(response: unknown): unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data
  }

  return Array.isArray(response) ? response : []
}

function valueContainsMessageId(value: unknown, messageId: string): boolean {
  if (typeof value === "string") {
    return value.includes(messageId)
  }

  if (Array.isArray(value)) {
    return value.some((entry) => valueContainsMessageId(entry, messageId))
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => valueContainsMessageId(entry, messageId))
  }

  return false
}

async function findAcceptedReclaimedMessageIds(
  ctx: ExecutorContext,
  member: RuntimeStateMember,
  messageIds: readonly string[],
): Promise<string[]> {
  if (messageIds.length === 0 || member.sessionId === undefined) {
    return []
  }

  try {
    const response = await ctx.client.session.messages({ path: { id: member.sessionId } })
    const messages = getMessagesData(response)
    return messageIds.filter((messageId) => messages.some((message) => valueContainsMessageId(message, messageId)))
  } catch (historyError) {
    log("team mailbox reclaimed reservation history check failed", {
      event: "team-mailbox-reclaim-history-check-failed",
      member: member.name,
      sessionID: member.sessionId,
      error: historyError instanceof Error ? historyError.message : String(historyError),
    })
    return []
  }
}

async function reconcileReclaimedReservations(
  ctx: ExecutorContext,
  teamRunId: string,
  member: RuntimeStateMember,
  reclaimedMessageIds: readonly string[],
  config: TeamModeConfig,
): Promise<void> {
  if (reclaimedMessageIds.length === 0) {
    return
  }

  const acceptedMessageIds = await findAcceptedReclaimedMessageIds(ctx, member, reclaimedMessageIds)
  if (acceptedMessageIds.length > 0) {
    await ackMessages(teamRunId, member.name, acceptedMessageIds, config)
  }

  const reclaimedMessageIdSet = new Set(reclaimedMessageIds)
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    members: currentRuntimeState.members.map((currentMember) => (
      currentMember.name === member.name
        ? {
          ...currentMember,
          pendingInjectedMessageIds: currentMember.pendingInjectedMessageIds.filter((messageId) => !reclaimedMessageIdSet.has(messageId)),
        }
        : currentMember
    )),
  }), config)
}

interface WorkerLiveness {
  readonly name: string
  readonly wasSpawned: boolean
  readonly stillAlive: boolean
}

async function inspectWorkerMembers(
  ctx: ExecutorContext,
  runtimeState: RuntimeState,
): Promise<WorkerLiveness[]> {
  const workerMembers = runtimeState.members.filter((member) => member.agentType !== "leader")

  return await Promise.all(workerMembers.map(async (member) => {
    if (member.status === "errored") {
      return { name: member.name, wasSpawned: true, stillAlive: false }
    }

    if (member.sessionId === undefined) {
      return { name: member.name, wasSpawned: false, stillAlive: true }
    }

    const stillAlive = await sessionExists(ctx, member.sessionId)
    return { name: member.name, wasSpawned: true, stillAlive }
  }))
}

export async function resumeAllTeams(
  ctx: ExecutorContext,
  config: TeamModeConfig,
): Promise<ResumeReport> {
  const report: ResumeReport = {
    resumed: 0,
    marked_failed: 0,
    marked_orphaned: 0,
    cleaned: 0,
    errors: [],
  }
  const now = Date.now()
  const activeTeams = await listActiveTeams(config)

  for (const activeTeam of activeTeams) {
    try {
      const runtimeState = await loadRuntimeState(activeTeam.teamRunId, config)

      switch (runtimeState.status) {
        case "creating": {
          if (!isCreatingStateStuck(runtimeState, now)) break
          await cleanupMemberWorktrees(runtimeState)
          await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
            ...currentRuntimeState,
            status: "failed",
          }), config)
          report.marked_failed += 1
          break
        }

        case "active": {
          if (!runtimeState.leadSessionId || !(await sessionExists(ctx, runtimeState.leadSessionId))) {
            await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
              ...currentRuntimeState,
              status: "orphaned",
            }), config)
            report.marked_orphaned += 1
            break
          }

          await Promise.all(runtimeState.members.map(async (member) => {
            try {
              const reclaimedMessageIds = await reclaimStaleReservations(
                runtimeState.teamRunId,
                member.name,
                config,
                STALE_RESERVATION_TTL_MS,
              )
              await reconcileReclaimedReservations(ctx, runtimeState.teamRunId, member, reclaimedMessageIds, config)
            } catch (reclaimError) {
              log("team mailbox reservation reclaim failed", {
                event: "team-mailbox-reclaim-failed",
                teamRunId: runtimeState.teamRunId,
                member: member.name,
                error: reclaimError instanceof Error ? reclaimError.message : String(reclaimError),
              })
            }
          }))

          const workerCheckResults = await inspectWorkerMembers(ctx, runtimeState)
          const deadWorkerNames = new Set(
            workerCheckResults
              .filter((result) => result.wasSpawned && !result.stillAlive)
              .map((result) => result.name),
          )
          const hasAliveWorker = workerCheckResults.some((result) => result.stillAlive)
          const hasAnyWorker = workerCheckResults.length > 0

          const markDeadWorkersErrored = (currentRuntimeState: RuntimeState): RuntimeState => ({
            ...currentRuntimeState,
            members: currentRuntimeState.members.map((member) => (
              deadWorkerNames.has(member.name)
                ? { ...member, status: "errored" as const, sessionId: undefined }
                : member
            )),
          })

          if (hasAnyWorker && !hasAliveWorker) {
            await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
              ...markDeadWorkersErrored(currentRuntimeState),
              status: "orphaned",
            }), config)
            report.marked_orphaned += 1
            break
          }

          if (deadWorkerNames.size > 0) {
            await transitionRuntimeState(runtimeState.teamRunId, markDeadWorkersErrored, config)
          }

          report.resumed += 1
          break
        }

        case "deleting": {
          await cleanupMemberWorktrees(runtimeState)
          await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
            ...currentRuntimeState,
            status: "deleted",
          }), config)
          if (await removeRuntimeDirectory(runtimeState.teamRunId, config)) {
            report.cleaned += 1
          }
          break
        }

        case "deleted":
        case "failed": {
          if (await removeRuntimeDirectory(runtimeState.teamRunId, config)) {
            report.cleaned += 1
          }
          break
        }

        case "shutdown_requested":
        case "orphaned": {
          break
        }
      }
    } catch (error) {
      const resumeError = toError(error)
      report.errors.push(resumeError)
      log("team runtime resume failed", {
        event: "team-runtime-resume-failed",
        teamRunId: activeTeam.teamRunId,
        teamName: activeTeam.teamName,
        status: activeTeam.status,
        error: resumeError.message,
      })
    }
  }

  return report
}
