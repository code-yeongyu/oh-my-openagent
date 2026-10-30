import type { AgentDefinition } from "./types"

export type AgentToolPolicy = {
  readonly toolAllowlist?: readonly string[]
  readonly toolDenylist?: readonly string[]
}

/**
 * The literal allow/deny rules a definition imposes on its child - the persona, the plan, the task
 * record and the kernel-tool grant all read the SAME derivation.
 *
 * Only literal patterns count: a glob or a spaced command rule is a per-invocation permission rule,
 * not a tool-surface rule. A definition whose only rules are denials therefore yields an EMPTY
 * allowlist, which is the most restrictive shape there is and must never be read as "no policy".
 */
export function agentToolPolicy(definition: AgentDefinition | undefined): AgentToolPolicy {
  if (definition === undefined) return {}
  const literalToolRules = definition.tools?.filter((rule) =>
    !rule.pattern.includes(" ") && !rule.pattern.includes("*")
  )
  const toolAllowlist = literalToolRules?.filter((rule) => rule.allow).map((rule) => rule.pattern)
  const toolRuleDenylist = literalToolRules?.filter((rule) => !rule.allow).map((rule) => rule.pattern)
  const toolDenylist = [...(definition.disallowedTools ?? []), ...(toolRuleDenylist ?? [])]
  return {
    ...(toolAllowlist !== undefined ? { toolAllowlist } : {}),
    ...(toolDenylist.length > 0 ? { toolDenylist } : {}),
  }
}
