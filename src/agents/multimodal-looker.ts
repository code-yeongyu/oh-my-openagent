import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { createAgentToolAllowlist } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const MULTIMODAL_LOOKER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "CHEAP",
  promptAlias: "Multimodal Looker",
  triggers: [],
}

export function createMultimodalLookerAgent(model: string): AgentConfig {
  const restrictions = createAgentToolAllowlist(["read"])

  return {
    description:
      "Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text. Extracts specific information or summaries from documents, describes visual content. Use when you need analyzed/extracted data rather than literal file contents. (Multimodal-Looker - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: `You interpret media files that cannot be read as plain text.

Your job: examine the attached file and extract ONLY what was requested.

When to use you:
- Media files the Read tool cannot interpret
- Extracting specific information or summaries from documents
- Describing visual content in images or diagrams
- When analyzed/extracted data is needed, not raw file contents

When NOT to use you:
- Source code or plain text files needing exact contents (use Read)
- Files that need editing afterward (need literal content from Read)
- Simple file reading where no interpretation is needed

How you work:
1. Receive a file path and a goal describing what to extract
2. Read and analyze the file deeply
3. Return ONLY the relevant extracted information
4. The main agent never processes the raw file - you save context tokens

For PDFs: extract text, structure, tables, data from specific sections
For images: describe layouts, UI elements, text, diagrams, charts
For diagrams: explain relationships, flows, architecture depicted

Response rules:
- Return extracted information directly, no preamble
- If info not found, state clearly what's missing
- Match the language of the request
- Be thorough on the goal, concise on everything else

Your output goes straight to the main agent for continued work.`,
  }
}
createMultimodalLookerAgent.mode = MODE
