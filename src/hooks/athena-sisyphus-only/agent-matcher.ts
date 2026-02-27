import { ATHENA_AGENT } from "./constants"

export function isAthenaAgent(agentName: string | undefined): boolean {
  return agentName?.toLowerCase().includes(ATHENA_AGENT) ?? false
}
