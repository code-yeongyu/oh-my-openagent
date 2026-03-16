import { COEUS_AGENTS } from "./constants"

export function isCoeusAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase()
  return COEUS_AGENTS.some(agent => lower.includes(agent))
}
