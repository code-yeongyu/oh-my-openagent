import { z } from "zod"

import type { AgentToolRule } from "./types"

const ToolActionSchema = z.enum(["allow", "deny"])

export const ToolRuleEntrySchema = z.union([
  z.string(),
  z.object({
    pattern: z.string().optional(),
    name: z.string().optional(),
    tool: z.string().optional(),
    allow: z.boolean().optional(),
    deny: z.boolean().optional(),
    action: ToolActionSchema.optional(),
  }).passthrough(),
])

export const ToolsInputSchema = z.union([
  z.record(z.string(), z.boolean()),
  z.array(ToolRuleEntrySchema),
])

export type ToolsInput = z.infer<typeof ToolsInputSchema>
type ToolRuleEntry = z.infer<typeof ToolRuleEntrySchema>

export function normalizeToolRules(input: ToolsInput | undefined): readonly AgentToolRule[] | undefined {
  if (input === undefined) return undefined
  const rules = Array.isArray(input)
    ? input.flatMap((entry) => normalizeToolRuleEntry(entry))
    : Object.entries(input).map(([pattern, allow]) => ({ pattern, allow }))
  return rules
}

export function resolveToolRule(rules: readonly AgentToolRule[], toolName: string): boolean | undefined {
  let decision: boolean | undefined
  for (const rule of rules) {
    if (toolPatternMatches(rule.pattern, toolName)) decision = rule.allow
  }
  return decision
}

function normalizeToolRuleEntry(entry: ToolRuleEntry): readonly AgentToolRule[] {
  if (typeof entry === "string") {
    if (entry.startsWith("!") || entry.startsWith("-")) return [{ pattern: entry.slice(1), allow: false }]
    return [{ pattern: entry, allow: true }]
  }

  const pattern = entry.pattern ?? entry.name ?? entry.tool
  if (pattern === undefined) return []
  if (entry.action !== undefined) return [{ pattern, allow: entry.action === "allow" }]
  if (entry.deny === true) return [{ pattern, allow: false }]
  return [{ pattern, allow: entry.allow ?? true }]
}

function toolPatternMatches(pattern: string, toolName: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1))
  return pattern === toolName
}
