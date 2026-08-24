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
import { resolveRequestedModelOverride } from "@oh-my-opencode/delegate-core"
import { parseModelString } from "../../../shared"
import { fuzzyMatchModel } from "../../../shared/model-availability"
import { getAvailableModelsForDelegateTask } from "../../../tools/delegate-task/available-models"

// Optional per-member model override declared on the team member spec, gated to
// connected/available models. Throws (surfaced as TeamMemberResolutionError) when
// the declared model is malformed or unavailable, so a bad spec fails team creation
// loudly instead of silently spawning the configured default.
async function resolveMemberModelOverride(
  member: Member,
  ctx: ExecutorContext,
): Promise<DelegatedModelConfig | undefined> {
  if (!member.model) return undefined
  const availableModels = await getAvailableModelsForDelegateTask(ctx.client)
  const override = resolveRequestedModelOverride(
    { model: member.model, reasoningEffort: member.reasoning_effort },
    { availableModels, parseModelString, fuzzyMatchModel },
  )
  if (override.kind === "error") {
    throw new Error(`model override: ${override.message}`)
  }
  return override.kind === "resolved" ? override.model : undefined
}

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

// Strip global `agents.sisyphus-junior.model` override at the team-mode boundary —
// `resolveCategoryExecution` ranks it above category defaults (correct for plain
// `task(category=…)`, wrong here) and would collapse every team member to the same model.
function withoutSisyphusJuniorOverride(ctx: ExecutorContext): ExecutorContext {
  if (ctx.sisyphusJuniorModel === undefined) return ctx
  return { ...ctx, sisyphusJuniorModel: undefined }
}

export async function resolveMember(
  member: Member,
  ctx: ExecutorContext,
  categoryExamples: string,
  parentAgent?: string,
): Promise<ResolvedMember> {
  try {
    const memberModelOverride = await resolveMemberModelOverride(member, ctx)

    if (member.kind === "category") {
      const execution = await resolveCategoryExecution(
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

      const categoryModel = memberModelOverride ?? execution.categoryModel
      return {
        memberName: member.name,
        agentToUse: execution.agentToUse,
        model: categoryModel,
        fallbackChain: execution.fallbackChain,
        systemContent: resolveSystemContent({
          agentToUse: execution.agentToUse,
          categoryPromptAppend: execution.categoryPromptAppend,
          maxPromptTokens: execution.maxPromptTokens,
          model: categoryModel,
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

    const subagentModel = memberModelOverride ?? execution.categoryModel
    return {
      memberName: member.name,
      agentToUse: execution.agentToUse,
      model: subagentModel,
      fallbackChain: execution.fallbackChain,
      systemContent: resolveSystemContent({
        agentToUse: execution.agentToUse,
        model: subagentModel,
      }),
    }
  } catch (error) {
    throw new TeamMemberResolutionError(member.name, normalizeResolutionError(error))
  }
}
