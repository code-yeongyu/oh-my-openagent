import type { DefaultModeConfig } from "../config/schema/default-mode"
import { reconcileSisyphusRuntimePrompt } from "../agents/sisyphus-runtime-prompt-reconciler"
import type { RuntimePromptAppendRegistry } from "../agents/runtime-prompt-append-reconciler"
import { getSessionAgent } from "../features/claude-code-session-state"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
  runtimePromptAppend?: {
    reconcileRuntimePromptAppend?: RuntimePromptAppendRegistry["reconcile"]
    getSessionAgent?: (sessionID: string) => string | undefined
    isCompactionRequest?: (sessionID: string) => boolean
  },
): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  const resolveSessionAgent = runtimePromptAppend?.getSessionAgent ?? getSessionAgent

  return async (input, output): Promise<void> => {
    if (input.sessionID && runtimePromptAppend?.isCompactionRequest?.(input.sessionID)) return

    const modelID = input.model?.id
    const runtimeModel = modelID && input.model.providerID
      ? `${input.model.providerID}/${modelID}`
      : modelID

    // The Sisyphus prompt body is model-family-specific and baked at registration
    // from the *configured* model in .omo/omo.jsonc. This per-request hook
    // is the only seam that knows the model actually selected at runtime, so
    // rebuild the whole body for the runtime model family here (issue #5297).
    const sisyphusReconciled = reconcileSisyphusRuntimePrompt(output.system, runtimeModel)
    if (!sisyphusReconciled) {
      runtimePromptAppend?.reconcileRuntimePromptAppend?.({
        system: output.system,
        agentName: input.sessionID ? resolveSessionAgent(input.sessionID) : undefined,
        runtimeModel,
      })
    }

    if (!defaultMode?.ultrawork || !getUltraworkMessage) return

    // Avoid re-injecting if the ultrawork prompt is already in the system prompt
    // (e.g. after compaction the system prompt is rebuilt and this hook fires again)
    if (output.system.some((part) => part.includes(ULTRAWORK_MODE_TAG))) return

    const ultraworkMessage = getUltraworkMessage("sisyphus", modelID)
    if (!ultraworkMessage) return

    output.system.push(ultraworkMessage)
  }
}
