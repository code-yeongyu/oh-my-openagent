import { log, normalizeModelID } from "../../shared"

const CLAUDE_4_6_PATTERN = /claude-(opus|sonnet)-4[-.]6/i

const DEFAULT_TRIGGER_TOKENS = 128_000

function isClaudeProvider(providerID: string, modelID: string): boolean {
  if (["anthropic", "google-vertex-anthropic", "opencode"].includes(providerID)) return true
  if (providerID === "github-copilot" && modelID.toLowerCase().includes("claude")) return true
  return false
}

function isClaude46(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  return CLAUDE_4_6_PATTERN.test(normalized)
}

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

export interface ServerCompactionConfig {
  triggerTokens?: number
  instructions?: string
}

export function createAnthropicServerCompactionHook(config: ServerCompactionConfig = {}) {
  const triggerTokens = config.triggerTokens ?? DEFAULT_TRIGGER_TOKENS

  return {
    "chat.params": async (
      input: ChatParamsInput,
      output: ChatParamsOutput
    ): Promise<void> => {
      const { model } = input
      if (!model?.modelID || !model?.providerID) return
      if (!isClaudeProvider(model.providerID, model.modelID)) return
      if (!isClaude46(model.modelID)) return
      if (output.options.contextManagement !== undefined) return

      const edit: Record<string, unknown> = {
        type: "compact_20260112",
        trigger: { type: "input_tokens", value: triggerTokens },
        pauseAfterCompaction: false,
      }

      if (config.instructions) {
        edit.instructions = config.instructions
      }

      output.options.contextManagement = {
        edits: [edit],
      }

      log("anthropic-server-compaction: injected context_management", {
        sessionID: input.sessionID,
        provider: model.providerID,
        model: model.modelID,
        triggerTokens,
      })
    },
  }
}
