import * as z from "zod"

import type { AgentToolRule } from "./types"

const ToolActionSchema = z.enum(["allow", "deny", "ask"])

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

// pi-task's documented `tools:` frontmatter contract (README.md:24-55, parsed by
// its readPermissionConfig): a record whose values are booleans, "allow"/"deny"/"ask"
// string actions, or nested command-pattern maps of those actions.
const ToolPermissionValueSchema = z.union([
  z.boolean(),
  ToolActionSchema,
  z.record(z.string(), ToolActionSchema),
])

export const ToolsInputSchema = z.union([
  z.record(z.string(), z.boolean()),
  z.record(z.string(), ToolPermissionValueSchema),
  z.array(ToolRuleEntrySchema),
])

export type ToolsInput = z.infer<typeof ToolsInputSchema>
type ToolRuleEntry = z.infer<typeof ToolRuleEntrySchema>
type ToolPermissionValue = z.infer<typeof ToolPermissionValueSchema>

export function normalizeToolRules(input: ToolsInput | undefined): readonly AgentToolRule[] | undefined {
  if (input === undefined) return undefined
  const rules = Array.isArray(input)
    ? input.flatMap((entry) => normalizeToolRuleEntry(entry))
    : Object.entries(input).flatMap(([tool, value]) => normalizeToolPermission(tool, value))
  return rules
}

// Converts one pi-task `tools:` record entry into last-match-wins AgentToolRule(s).
// A boolean or string action yields a single tool-level rule; a nested map yields one
// rule per command pattern (order preserved), encoded as a `"<tool> <pattern>"` compound
// pattern so the existing wildcard matcher evaluates command-scoped invocations.
// "allow" grants; "deny" and "ask" are non-grants (mirrors pi's isSubagentAllowed, where
// only "allow" permits) so an explicit "ask" still overrides a broader "allow".
function normalizeToolPermission(tool: string, value: ToolPermissionValue): readonly AgentToolRule[] {
  if (typeof value === "boolean") return [{ pattern: tool, allow: value }]
  if (typeof value === "string") return [{ pattern: tool, allow: value === "allow" }]
  return Object.entries(value).map(([commandPattern, action]) => ({
    pattern: `${tool} ${commandPattern}`,
    allow: action === "allow",
  }))
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
