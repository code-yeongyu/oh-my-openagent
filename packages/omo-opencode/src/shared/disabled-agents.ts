import { AGENT_NAME_MAP } from "./migration"

export function migrateDisabledAgents(disabledAgents: readonly string[] | undefined): string[] {
  return (disabledAgents ?? []).map(
    (agent) => AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent,
  )
}
