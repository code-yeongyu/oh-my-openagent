import { ORACLE_AGENT } from "./constants"

export function isOracleAgent(agentName: string | undefined): boolean {
  return agentName?.toLowerCase().includes(ORACLE_AGENT) ?? false
}
