import { getAgentConfigKey } from "../../../shared/agent-display-names"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { AGENT_ELIGIBILITY_REGISTRY } from "../types"
import type { TeamSpec } from "../types"
import type { FinalOpenCodeAgent } from "../final-open-code-agent-registry"
import { parseFinalOpenCodeAgentRegistry } from "../final-open-code-agent-registry"
import { cleanupPreparedTeamRunResources } from "./cleanup-team-run-resources"
import { ProjectAgentMemberError } from "./project-agent-member"
import { resolveMember, type ResolvedMember } from "./resolve-member"
import type { SpawnedMemberResource, TeamRunCleanupReport } from "./team-run-create-types"
import { reserveOwnedWorktreeDirectory, type WorktreeOwnership } from "./worktree-ownership"

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
): Promise<{ readonly directory: string } & Partial<WorktreeOwnership>> {
  if (!worktreePath) {
    return { directory: projectRoot }
  }
  const reservation = await reserveOwnedWorktreeDirectory(worktreePath, projectRoot)
  return {
    directory: reservation.directory,
    ...(reservation.ownership ?? {}),
  }
}

async function canReuseCallerAsLead(
  member: TeamSpec["members"][number],
  ctx: ExecutorContext,
  directory: string,
): Promise<boolean> {
  if (member.kind === "category") return true
  if (AGENT_ELIGIBILITY_REGISTRY[getAgentConfigKey(member.subagent_type)] === undefined) return false
  const registry = parseFinalOpenCodeAgentRegistry(
    await ctx.client.app.agents({ query: { directory } }),
  )
  if (registry.find((agent) => agent.name === member.subagent_type)?.native === false) {
    throw new ProjectAgentMemberError(
      `Project agent '${member.subagent_type}' is member-only and cannot be selected or reused as a team lead.`,
    )
  }
  return true
}

export async function prepareTeamMembers(input: {
  readonly spec: TeamSpec
  readonly ctx: ExecutorContext
  readonly reusesCallerLeadSession: boolean
  readonly parentSessionPermission: FinalOpenCodeAgent["permission"]
  readonly teamSessionPermission: FinalOpenCodeAgent["permission"]
}): Promise<readonly PreparedTeamMember[]> {
  const resources: SpawnedMemberResource[] = []

  try {
    const memberDirectories = []
    for (const member of input.spec.members) {
      const preparedDirectory = await resolveMemberDirectory(member.worktreePath, input.ctx.directory)
      const resource: SpawnedMemberResource = {
        ...(member.worktreePath ? { worktreePath: preparedDirectory.directory } : {}),
        ...(preparedDirectory.ownedWorktreeRoot ? {
          ownedWorktreeRoot: preparedDirectory.ownedWorktreeRoot,
          worktreeOwnershipToken: preparedDirectory.worktreeOwnershipToken,
          worktreeCanonicalPath: preparedDirectory.worktreeCanonicalPath,
        } : {}),
      }
      resources.push(resource)
      memberDirectories.push({ member, directory: preparedDirectory.directory, resource })
    }

    const categoryExamples = Object.keys(input.ctx.userCategories ?? {}).join(", ")
    return await Promise.all(memberDirectories.map(async ({ member, directory, resource }) => {
      const reusesCaller = input.reusesCallerLeadSession
        && member.name === input.spec.leadAgentId
        && await canReuseCallerAsLead(member, input.ctx, directory)
      if (reusesCaller) {
        return { kind: "reused-lead", member, directory, resource }
      }

      const resolvedMember = await resolveMember(member, input.ctx, {
        categoryExamples,
        directory,
        isLead: member.name === input.spec.leadAgentId,
        parentAgent: input.spec.leadAgentId,
        parentSessionPermission: input.parentSessionPermission,
        teamSessionPermission: input.teamSessionPermission,
      })
      return { kind: "launch", member, directory, resource, resolvedMember }
    }))
  } catch (error) {
    const cleanupReport = await cleanupPreparedTeamRunResources({ resources })
    const cause = error instanceof Error ? error : new Error(String(error))
    throw new TeamMemberPreflightError(cause, cleanupReport)
  }
}
