import type { AgentConfig } from "@opencode-ai/sdk"
import { createSisyphusAgent } from "./sisyphus"
import { composeForkExtensions } from "./sisyphus-fork-extensions"

const DEFAULT_MODEL = "anthropic/claude-opus-4-5"

const OMO_DESCRIPTION =
  "Powerful AI orchestrator for OpenCode (fork). " +
  "Built on Sisyphus foundation with spec-driven workflow, " +
  "Linear integration, and governance features. " +
  "Plans obsessively with todos, assesses search complexity before exploration, " +
  "delegates strategically to specialized agents."

export function createOmoAgent(model: string = DEFAULT_MODEL): AgentConfig {
  const sisyphusBase = createSisyphusAgent(model)
  const forkExtensions = composeForkExtensions()

  return {
    ...sisyphusBase,
    description: OMO_DESCRIPTION,
    prompt: sisyphusBase.prompt + "\n\n" + forkExtensions,
    color: "#00CED1",
    tools: {
      task: false,
    },
  }
}

export const omoAgent = createOmoAgent()
