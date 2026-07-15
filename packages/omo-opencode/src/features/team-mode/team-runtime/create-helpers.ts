import { access } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { BackgroundTask } from "../../background-agent/types"
import type { BackgroundManager } from "../../background-agent/manager"
import { buildTeammateCommunicationAddendum } from "../member-guidance"
import { getTeamSpecPath, resolveBaseDir } from "../team-registry/paths"
import { listActiveTeams, loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import type { RuntimeState, TeamSpec } from "../types"
import type { PreparedTeamMember } from "./prepare-team-members"
import { hasUnresolvedTeamMembers } from "./unresolved-team-members"

const SESSION_ID_POLL_MS = 25

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function resolveSpecSource(
  spec: TeamSpec,
  projectRoot: string,
  config: TeamModeConfig,
): Promise<"project" | "user"> {
  const baseDir = resolveBaseDir(config)
  if (await pathExists(getTeamSpecPath(baseDir, spec.name, "project", projectRoot))) return "project"
  if (await pathExists(getTeamSpecPath(baseDir, spec.name, "user"))) return "user"
  return "project"
}

export async function findExistingRuntime(
  spec: TeamSpec,
  leadSessionId: string,
  config: TeamModeConfig,
): Promise<RuntimeState | undefined> {
  for (const candidate of await listActiveTeams(config)) {
    if (candidate.teamName !== spec.name || (candidate.status !== "creating" && candidate.status !== "active")) continue
    const runtimeState = await loadRuntimeState(candidate.teamRunId, config).catch(() => undefined)
    if (runtimeState?.leadSessionId === leadSessionId && !hasUnresolvedTeamMembers(runtimeState.members)) {
      return runtimeState
    }
  }
}

export async function waitForTaskSessionId(
  bgMgr: BackgroundManager,
  task: BackgroundTask,
  deadlineAt: number,
): Promise<string> {
  let sessionId = task.sessionId
  while (!sessionId) {
    if (Date.now() > deadlineAt) throw new Error(`timed out waiting for child session for task ${task.id}`)
    const updatedTask = bgMgr.getTask(task.id)
    if (updatedTask?.status === "error" || updatedTask?.status === "cancelled" || updatedTask?.status === "interrupt") {
      throw new Error(updatedTask.error ?? `task ${task.id} failed before session creation`)
    }
    sessionId = updatedTask?.sessionId
    if (!sessionId) await new Promise((resolve) => setTimeout(resolve, SESSION_ID_POLL_MS))
  }
  return sessionId
}

export function buildMemberPrompt(input: {
  readonly spec: TeamSpec
  readonly member: TeamSpec["members"][number]
  readonly teamRunId: string
  readonly config: TeamModeConfig
  readonly worktreePath?: string
}): string {
  const promptLines = [`Team: ${input.spec.name}`, `TeamRunId: ${input.teamRunId}`, `Member: ${input.member.name}`]
  if (input.worktreePath) promptLines.push(`Worktree: ${input.worktreePath}`)
  if (input.member.prompt) promptLines.push(input.member.prompt)
  promptLines.push(buildTeammateCommunicationAddendum(input.config))
  return promptLines.join("\n")
}

export async function updateMemberInRuntimeState(input: {
  readonly teamRunId: string
  readonly memberName: string
  readonly patch: (member: RuntimeState["members"][number]) => RuntimeState["members"][number]
  readonly config: TeamModeConfig
}): Promise<RuntimeState> {
  return transitionRuntimeState(input.teamRunId, (currentState) => ({
    ...currentState,
    members: currentState.members.map((member) =>
      member.name === input.memberName ? input.patch(member) : member,
    ),
  }), input.config)
}

export async function persistPreparedMemberResources(input: {
  readonly teamRunId: string
  readonly preparedMembers: readonly PreparedTeamMember[]
  readonly config: TeamModeConfig
}): Promise<RuntimeState> {
  const resourcesByMemberName = new Map(input.preparedMembers.map((preparedMember) => [
    preparedMember.member.name,
    preparedMember.resource,
  ]))
  return transitionRuntimeState(input.teamRunId, (currentState) => ({
    ...currentState,
    members: currentState.members.map((member) => {
      const resource = resourcesByMemberName.get(member.name)
      if (!resource) return member
      return {
        ...member,
        ...(resource.worktreePath ? { worktreePath: resource.worktreePath } : {}),
        ...(resource.ownedWorktreeRoot ? { ownedWorktreeRoot: resource.ownedWorktreeRoot } : {}),
        ...(resource.worktreeOwnershipToken ? { worktreeOwnershipToken: resource.worktreeOwnershipToken } : {}),
        ...(resource.worktreeCanonicalPath ? { worktreeCanonicalPath: resource.worktreeCanonicalPath } : {}),
      }
    }),
  }), input.config)
}
