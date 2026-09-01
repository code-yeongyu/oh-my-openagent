import { z } from "zod"

import type { AgentOverrides, CategoriesConfig } from "../../../config/schema"
import { mergeCategories } from "../../../shared/merge-categories"
import { normalizeTeamSpecInput } from "@oh-my-opencode/team-core/team-registry/loader"
import { validateSpec } from "@oh-my-opencode/team-core/team-registry/validator"
import { TeamSpecSchema, type TeamSpec } from "@oh-my-opencode/team-core/types"

export const TEAM_CREATE_USAGE = "team_create requires exactly one of teamName or inline_spec. Use team_create({ teamName: \"existing-team\" }) or team_create({ inline_spec: { name: \"team-name\", members: [{ name: \"worker\", category: \"quick\", prompt: \"Do the assigned work.\" }] } })."

function omitEmptyStringArgs(rawArgs: unknown): unknown {
  if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
    return rawArgs
  }

  return Object.fromEntries(Object.entries(rawArgs).filter(([, value]) => value !== ""))
}

export const TeamCreateArgsSchema = z.preprocess(omitEmptyStringArgs, z.object({
  teamName: z.string().min(1).nullish(),
  inline_spec: z.unknown().nullish(),
  leadSessionId: z.string().nullish(),
}).superRefine((value, ctx) => {
  const optionCount = Number(value.teamName != null) + Number(value.inline_spec != null)
  if (optionCount !== 1) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one of teamName or inline_spec." })
  }
}))

export type TeamCreateArgs = z.infer<typeof TeamCreateArgsSchema>

export type TeamCreateExecutorConfig = {
  userCategories?: CategoriesConfig
  sisyphusJuniorModel?: string
  agentOverrides?: AgentOverrides
}

export function resolveDefaultInlineCategory(userCategories?: CategoriesConfig): string | undefined {
  const userCategoryName = Object.entries(userCategories ?? {}).find(([, categoryConfig]) => categoryConfig.disable !== true)?.[0]
  if (userCategoryName !== undefined) {
    return userCategoryName
  }

  return Object.keys(mergeCategories(userCategories))[0]
}

export function parseTeamCreateArgs(rawArgs: unknown): TeamCreateArgs {
  const result = TeamCreateArgsSchema.safeParse(rawArgs)
  if (!result.success) {
    throw new Error(TEAM_CREATE_USAGE)
  }

  return result.data
}

function formatZodIssuePath(path: PropertyKey[]): string {
  return path.length > 0 ? path.join(".") : "<root>"
}

function formatTeamSpecIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${formatZodIssuePath(issue.path)}: ${issue.message}`)
    .join("; ")
}

export function parseInlineTeamSpec(
  rawSpec: unknown,
  options?: Parameters<typeof normalizeTeamSpecInput>[1],
): TeamSpec {
  let specObject: unknown = rawSpec
  if (typeof rawSpec === "string") {
    try {
      specObject = JSON.parse(rawSpec)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`inline_spec is a string but not valid JSON: ${message}`)
    }
  }

  const parsedSpecResult = TeamSpecSchema.safeParse(normalizeTeamSpecInput(specObject, options))
  if (!parsedSpecResult.success) {
    throw new Error(`Invalid inline_spec for team_create: ${formatTeamSpecIssues(parsedSpecResult.error)}. Provide an object with name and members array. Example: team_create({ inline_spec: { name: "project-analysis-team", members: [{ name: "structure-analyst", category: "quick", prompt: "Analyze project structure." }] } }).`)
  }

  const parsedSpec = parsedSpecResult.data
  validateSpec(parsedSpec)
  return parsedSpec
}
