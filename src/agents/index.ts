import type { AgentConfig } from "@opencode-ai/sdk"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"

export const builtinAgents: Record<string, AgentConfig> = {
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
}
