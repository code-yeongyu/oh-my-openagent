import { mkdir } from "node:fs/promises"
import path from "node:path"

import { getAgentConfigKey } from "../../../shared/agent-display-names"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { AGENT_ELIGIBILITY_REGISTRY } from "../types"
import type { TeamSpec } from "../types"
import { cleanupPreparedTeamRunResources } from "./cleanup-team-run-resources"
import { resolveMember, type ResolvedMember } from "./resolve-member"
import type { SpawnedMemberResource, TeamRunCleanupReport } from "./team-run-create-types"

type PreparedMemberBase = {
  readonly member: TeamSpec["members"][number]
  readonly directory: string
  readonly resource: SpawnedMemberResource
}

export type PreparedTeamMember =
  | (PreparedMemberBase & { readonly kind: "reused-lead" })
  | (PreparedMemberBase & { readonly kind: "launch"; readonly resolvedMember: ResolvedMember })

export class TeamMemberPreflightError extends Error {
  constructor(
    cause: Error,
    public readonly cleanupReport: TeamRunCleanupReport,
  ) {
    super(cause.message)
    this.name = "TeamMemberPreflightError"
    this.cause = cause
  }
}

export async function resolveMemberDirectory(
  worktreePath: string | undefined,
  projectRoot: string,
): Promise<{ readonly directory: string; readonly cleanupRoot?: string }> {
  if (!worktreePath) {
    return { directory: projectRoot }
  }

  const directory = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(projectRoot, worktreePath)
  const cleanupRoot = await mkdir(directory, { recursive: true })
  return { directory, cleanupRoot }
}

function canReuseCallerAsLead(member: TeamSpec["members"][number]): boolean {
  return member.kind === "category"
    || AGENT_ELIGIBILITY_REGISTRY[getAgentConfigKey(member.subagent_type)] !== undefined
}

export async function prepareTeamMembers(input: {
  readonly spec: TeamSpec
  readonly ctx: ExecutorContext
  readonly reusesCallerLeadSession: boolean
}): Promise<readonly PreparedTeamMember[]> {
  const resources: SpawnedMemberResource[] = []

  try {
    const memberDirectories = []
    for (const member of input.spec.members) {
      const preparedDirectory = await resolveMemberDirectory(member.worktreePath, input.ctx.directory)
      const resource: SpawnedMemberResource = {
        ...(member.worktreePath ? { worktreePath: preparedDirectory.directory } : {}),
        ...(preparedDirectory.cleanupRoot ? { ownedWorktreeRoot: preparedDirectory.cleanupRoot } : {}),
      }
      resources.push(resource)
      memberDirectories.push({ member, directory: preparedDirectory.directory, resource })
    }

    const categoryExamples = Object.keys(input.ctx.userCategories ?? {}).join(", ")
    return await Promise.all(memberDirectories.map(async ({ member, directory, resource }) => {
      const reusesCaller = input.reusesCallerLeadSession
        && member.name === input.spec.leadAgentId
        && canReuseCallerAsLead(member)
      if (reusesCaller) {
        return { kind: "reused-lead", member, directory, resource }
      }

      const resolvedMember = await resolveMember(member, input.ctx, {
        categoryExamples,
        directory,
        isLead: member.name === input.spec.leadAgentId,
        parentAgent: input.spec.leadAgentId,
      })
      return { kind: "launch", member, directory, resource, resolvedMember }
    }))
  } catch (error) {
    const cleanupReport = await cleanupPreparedTeamRunResources({ resources })
    const cause = error instanceof Error ? error : new Error(String(error))
    throw new TeamMemberPreflightError(cause, cleanupReport)
  }
}
