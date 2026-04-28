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

export class TeamMemberResolutionError extends Error {
  constructor(public readonly memberName: string, public readonly cause: Error) {
    super(`Failed to resolve member '${memberName}': ${cause.message}`)
    this.name = "TeamMemberResolutionError"
  }
}

export interface ResolvedMember {
  memberName: string
  agentToUse: string
  model: DelegatedModelConfig | undefined
  fallbackChain: FallbackEntry[] | undefined
  systemContent: string
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
}): string {
  return buildSystemContent({
    agentName: input.agentToUse,
    categoryPromptAppend: input.categoryPromptAppend,
    maxPromptTokens: input.maxPromptTokens,
    model: input.model,
  }) ?? ""
}

export async function resolveMember(
  member: Member,
  ctx: ExecutorContext,
  categoryExamples: string,
  parentAgent?: string,
): Promise<ResolvedMember> {
  try {
    if (member.kind === "category") {
      const execution = await resolveCategoryExecution(
        {
          ...createBaseDelegateTaskArgs(member.prompt),
          category: member.category,
          subagent_type: "sisyphus-junior",
        },
        ctx,
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
        }),
      }
    }

    const execution = await resolveSubagentExecution(
      {
        ...createBaseDelegateTaskArgs(member.prompt ?? ""),
        subagent_type: member.subagent_type,
      },
      ctx,
      parentAgent,
      categoryExamples,
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
      }),
    }
  } catch (error) {
    throw new TeamMemberResolutionError(member.name, normalizeResolutionError(error))
  }
}
