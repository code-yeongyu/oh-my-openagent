import type { AgentOverrides } from "../../config"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getUltraworkConfig(agents: AgentOverrides | undefined, configKey: string) {
  if (!agents) return undefined

  for (const [agentKey, override] of Object.entries(agents)) {
    if (getAgentConfigKey(agentKey) === configKey) {
      return override?.ultrawork
    }
  }

  return undefined
}

export function createUltraworkModelOverrideHook(args: { agents?: AgentOverrides }) {
  let didLogSpikeInput = false

  return {
    "chat.params": async (input: unknown, output: unknown): Promise<void> => {
      if (!didLogSpikeInput) {
        didLogSpikeInput = true

        const inputRecord = isRecord(input) ? input : null
        const messageRecord = isRecord(inputRecord?.message) ? inputRecord.message : null

        log("ultrawork-model-override spike: raw chat.params input", {
          inputType: typeof input,
          outputType: typeof output,
          hasMessage: messageRecord !== null,
          messageKeys: messageRecord ? Object.keys(messageRecord) : [],
          hasMessageModel: messageRecord ? "model" in messageRecord : false,
          messageModelType: messageRecord ? typeof messageRecord.model : "undefined",
        })
      }

      if (!isRecord(input)) return

      const message = input.message
      if (!isRecord(message)) return
      if (message.variant !== "max") return

      const agentName = input.agent
      if (typeof agentName !== "string") return

      const configKey = getAgentConfigKey(agentName)
      const ultrawork = getUltraworkConfig(args.agents, configKey)
      if (!ultrawork?.model) return

      const separatorIndex = ultrawork.model.indexOf("/")
      const providerID = separatorIndex === -1 ? ultrawork.model : ultrawork.model.slice(0, separatorIndex)
      const modelID = separatorIndex === -1 ? "" : ultrawork.model.slice(separatorIndex + 1)

      const previousModel = isRecord(message.model)
        ? {
            providerID:
              typeof message.model.providerID === "string" ? message.model.providerID : undefined,
            modelID: typeof message.model.modelID === "string" ? message.model.modelID : undefined,
          }
        : undefined

      message.model = { providerID, modelID }

      if (ultrawork.variant !== undefined) {
        message.variant = ultrawork.variant
      }

      log("ultrawork-model-override: swapped model", {
        sessionID: typeof input.sessionID === "string" ? input.sessionID : undefined,
        agent: agentName,
        configKey,
        from: previousModel,
        to: message.model,
        variant: message.variant,
      })
    },
  }
}
