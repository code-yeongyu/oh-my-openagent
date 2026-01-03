import type { AgentConfig } from "@opencode-ai/sdk"
import { sisyphusAgent } from "./sisyphus"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"
import { multimodalLookerAgent } from "./multimodal-looker"
import { knowledgeCuratorAgent } from "./knowledge-curator"
import { debuggerAgent } from "./debugger"
import { devopsEngineerAgent } from "./devops-engineer"
import { projectManagerAgent } from "./project-manager"
import { testEngineerAgent } from "./test-engineer"
import { codeReviewerAgent } from "./code-reviewer"
import { incidentCommanderAgent } from "./incident-commander"
import { securityReviewerAgent } from "./security-reviewer"
import { codeIndexerAgent } from "./code-indexer"
import { performanceAnalystAgent } from "./performance-analyst"
import { apiDesignerAgent } from "./api-designer"
import { dbaAgent } from "./dba"
import { estimatorAgent } from "./estimator"

export const builtinAgents: Record<string, AgentConfig> = {
  Sisyphus: sisyphusAgent,
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
  "multimodal-looker": multimodalLookerAgent,
  "knowledge-curator": knowledgeCuratorAgent,
  "debugger": debuggerAgent,
  "devops-engineer": devopsEngineerAgent,
  "project-manager": projectManagerAgent,
  "test-engineer": testEngineerAgent,
  "code-reviewer": codeReviewerAgent,
  "incident-commander": incidentCommanderAgent,
  "security-reviewer": securityReviewerAgent,
  "code-indexer": codeIndexerAgent,
  "performance-analyst": performanceAnalystAgent,
  "api-designer": apiDesignerAgent,
  "dba": dbaAgent,
  "estimator": estimatorAgent,
}

export * from "./types"
export { createBuiltinAgents } from "./utils"
export type { AvailableAgent } from "./sisyphus-prompt-builder"
