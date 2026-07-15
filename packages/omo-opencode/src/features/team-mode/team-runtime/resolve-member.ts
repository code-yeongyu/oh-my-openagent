import type { FallbackEntry } from "../../../shared/model-requirements"
import type { DelegatedModelConfig } from "../../../shared/model-resolution-types"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { DelegateTaskArgs } from "../../../tools/delegate-task/types"
import type { Member } from "../types"
import {
  buildSystemContent,
  resolveCategoryExecution,
  resolveSubagentExecution,
} from "./resolve-member-dependencies"
import { resolveProjectAgentMember } from "./project-agent-member"

export class TeamMemberResolutionError extends Error {
  constructor(public readonly memberName: string, public readonly cause: Error) {
    super(`Failed to resolve member '${memberName}': ${cause.message}`)
    this.name = "TeamMemberResolutionError"
  }
}

export interface ResolvedMember {
  memberName: string
  agentToUse: string
  exactAgent?: boolean
  model: DelegatedModelConfig | undefined
  fallbackChain: FallbackEntry[] | undefined
  systemContent: string | undefined
}

export type ResolveMemberOptions = {
  readonly categoryExamples: string
  readonly directory: string
  readonly isLead: boolean
  readonly parentAgent?: string
}

export type ResolveMemberDependencies = {
  readonly buildSystemContent: typeof buildSystemContent
  readonly resolveCategoryExecution: typeof resolveCategoryExecution
  readonly resolveSubagentExecution: typeof resolveSubagentExecution
  readonly resolveProjectAgentMember: typeof resolveProjectAgentMember
}

const DEFAULT_RESOLVE_MEMBER_DEPENDENCIES: ResolveMemberDependencies = {
  buildSystemContent,
  resolveCategoryExecution,
  resolveSubagentExecution,
  resolveProjectAgentMember,
}

function createBaseDelegateTaskArgs(prompt: string): Pick<DelegateTaskArgs, "description" | "load_skills" | "prompt" | "run_in_background"> {
  return {
    description: "Resolve team member",
    load_skills: [],
    prompt,
    run_in_background: false,
  }
}

function normalizeResolutionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function resolveSystemContent(input: {
  agentToUse: string
  categoryPromptAppend?: string
  maxPromptTokens?: number
  model: DelegatedModelConfig | undefined
}, buildContent: typeof buildSystemContent): string {
  return buildContent({
    agentName: input.agentToUse,
    categoryPromptAppend: input.categoryPromptAppend,
    maxPromptTokens: input.maxPromptTokens,
    model: input.model,
  }) ?? ""
}

// Strip global `agents.sisyphus-junior.model` override at the team-mode boundary —
// `resolveCategoryExecution` ranks it above category defaults (correct for plain
// `task(category=…)`, wrong here) and would collapse every team member to the same model.
function withoutSisyphusJuniorOverride(ctx: ExecutorContext): ExecutorContext {
  if (ctx.sisyphusJuniorModel === undefined) return ctx
  return { ...ctx, sisyphusJuniorModel: undefined }
}

export function createResolveMember(
  dependencies: ResolveMemberDependencies = DEFAULT_RESOLVE_MEMBER_DEPENDENCIES,
): (member: Member, ctx: ExecutorContext, options: ResolveMemberOptions) => Promise<ResolvedMember> {
  return async (member, ctx, options) => {
    try {
      if (member.kind === "category") {
        const execution = await dependencies.resolveCategoryExecution(
          {
            ...createBaseDelegateTaskArgs(member.prompt),
            category: member.category,
            subagent_type: "sisyphus-junior",
          },
          withoutSisyphusJuniorOverride(ctx),
          undefined,
          undefined,
        )

        if (execution.error) {
          throw new Error(execution.error)
        }

        return {
          memberName: member.name,
          agentToUse: execution.agentToUse,
          model: execution.categoryModel,
          fallbackChain: execution.fallbackChain,
          systemContent: resolveSystemContent({
            agentToUse: execution.agentToUse,
            categoryPromptAppend: execution.categoryPromptAppend,
            maxPromptTokens: execution.maxPromptTokens,
            model: execution.categoryModel,
          }, dependencies.buildSystemContent),
        }
      }

      const projectAgentMember = await dependencies.resolveProjectAgentMember(member, ctx, {
        directory: options.directory,
        isLead: options.isLead,
      })
      if (projectAgentMember) {
        return projectAgentMember
      }

      const execution = await dependencies.resolveSubagentExecution(
        {
          ...createBaseDelegateTaskArgs(member.prompt ?? ""),
          subagent_type: member.subagent_type,
        },
        ctx,
        options.parentAgent,
        options.categoryExamples,
        {
          allowSisyphusJuniorDirect: true,
          allowPrimaryAgentDelegation: true,
        },
      )

      if (execution.error) {
        throw new Error(execution.error)
      }

      return {
        memberName: member.name,
        agentToUse: execution.agentToUse,
        model: execution.categoryModel,
        fallbackChain: execution.fallbackChain,
        systemContent: resolveSystemContent({
          agentToUse: execution.agentToUse,
          model: execution.categoryModel,
        }, dependencies.buildSystemContent),
      }
    } catch (error) {
      throw new TeamMemberResolutionError(member.name, normalizeResolutionError(error))
    }
  }
}

export const resolveMember = createResolveMember()
