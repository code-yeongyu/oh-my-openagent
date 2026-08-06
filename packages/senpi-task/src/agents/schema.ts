import * as z from "zod"

import { ToolsInputSchema, normalizeToolRules } from "./tools"
import type { AgentDefinition, AgentDefinitionInput } from "./types"

// Same effort levels omo-config-core enforces, so the markdown-frontmatter and overlay paths cannot
// accept a value asSenpiThinkingLevel would silently drop.
const ReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])

const AgentModelEntrySchema = z.union([
  z.string(),
  z.object({
    model: z.string(),
    variant: z.string().optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
  }).passthrough(),
])

export const RawAgentDefinitionSchema = z.object({
  description: z.string().optional(),
  prompt: z.string().optional(),
  mode: z.string().optional(),
  model: z.string().optional(),
  models: z.array(AgentModelEntrySchema).optional(),
  variant: z.string().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  tools: ToolsInputSchema.optional(),
  disable: z.boolean().optional(),
  background: z.boolean().optional(),
  executionMode: z.string().optional(),
  execution_mode: z.string().optional(),
  allowedSubagents: z.array(z.string()).optional(),
  allowed_subagents: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  maxDepth: z.number().int().nonnegative().optional(),
  max_depth: z.number().int().nonnegative().optional(),
  maxTurns: z.number().int().nonnegative().optional(),
  max_turns: z.number().int().nonnegative().optional(),
}).passthrough()

export const OmoAgentOverlaySchema = z.object({
  agents: z.record(z.string(), RawAgentDefinitionSchema).optional(),
}).passthrough()

export type RawAgentDefinition = z.infer<typeof RawAgentDefinitionSchema>

export function defineAgent(raw: AgentDefinitionInput): AgentDefinition {
  return { ...raw }
}

export function normalizeAgentDefinition(
  name: string,
  raw: RawAgentDefinition,
  prompt: string | undefined,
): AgentDefinition {
  return {
    name,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(raw.mode === undefined ? {} : { mode: raw.mode }),
    ...(raw.model === undefined ? {} : { model: raw.model }),
    ...(raw.models === undefined ? {} : { models: raw.models }),
    ...(raw.variant === undefined ? {} : { variant: raw.variant }),
    ...(raw.reasoningEffort === undefined ? {} : { reasoningEffort: raw.reasoningEffort }),
    ...(raw.temperature === undefined ? {} : { temperature: raw.temperature }),
    ...(raw.tools === undefined ? {} : { tools: normalizeToolRules(raw.tools) }),
    ...(raw.disable === undefined ? {} : { disable: raw.disable }),
    ...(raw.background === undefined ? {} : { background: raw.background }),
    ...optionalString("executionMode", raw.executionMode ?? raw.execution_mode),
    ...optionalStrings("allowedSubagents", raw.allowedSubagents ?? raw.allowed_subagents),
    ...optionalStrings("disallowedTools", raw.disallowedTools ?? raw.disallowed_tools),
    ...optionalNumber("maxDepth", raw.maxDepth ?? raw.max_depth),
    ...optionalNumber("maxTurns", raw.maxTurns ?? raw.max_turns),
  }
}

function optionalString(key: "executionMode", value: string | undefined): Pick<AgentDefinition, "executionMode"> | {} {
  return value === undefined ? {} : { [key]: value }
}

function optionalStrings(
  key: "allowedSubagents" | "disallowedTools",
  value: readonly string[] | undefined,
): Pick<AgentDefinition, "allowedSubagents" | "disallowedTools"> | {} {
  return value === undefined ? {} : { [key]: value }
}

function optionalNumber(
  key: "maxDepth" | "maxTurns",
  value: number | undefined,
): Pick<AgentDefinition, "maxDepth" | "maxTurns"> | {} {
  return value === undefined ? {} : { [key]: value }
}
