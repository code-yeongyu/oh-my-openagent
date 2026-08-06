import { resolveSessionEventID } from "../../shared/event-session-id"

export function isCompactionAgent(agent: string | undefined): boolean {
  return agent?.trim().toLowerCase() === "compaction"
}

export function resolveSessionID(props?: Record<string, unknown>): string | undefined {
  return resolveSessionEventID(props)
}
