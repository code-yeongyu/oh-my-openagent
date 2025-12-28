import type { AgentConfig } from "@opencode-ai/sdk"
import { sisyphusAgent } from "./sisyphus"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"
import { multimodalLookerAgent } from "./multimodal-looker"
import { codeReviewerAgent } from "./code-reviewer"

export const builtinAgents: Record<string, AgentConfig> = {
  Sisyphus: sisyphusAgent,
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
  "multimodal-looker": multimodalLookerAgent,
  "code-reviewer": codeReviewerAgent,
}

export * from "./types"
export { createBuiltinAgents } from "./utils"
export { 
  createCodeReviewerAgent, 
  CODE_REVIEWER_MODES, 
  CODE_REVIEWER_PROMPTS, 
  type CodeReviewerMode, 
  type CodeReviewerOptions 
} from "./code-reviewer"
