import type { DefaultModeConfig } from "../config/schema/default-mode"
import { reconcileSisyphusRuntimePrompt } from "../agents/sisyphus-runtime-prompt-reconciler"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
    // The Sisyphus prompt body is model-family-specific and baked at registration
    // from the *configured* model in oh-my-openagent.jsonc. This per-request hook
    // is the only seam that knows the model actually selected at runtime, so
    // rebuild the whole body for the runtime model family here (issue #5297).
    reconcileSisyphusRuntimePrompt(output.system, input.model?.id)

    if (!defaultMode?.ultrawork || !getUltraworkMessage) return

    // Avoid re-injecting if the ultrawork prompt is already in the system prompt
    // (e.g. after compaction the system prompt is rebuilt and this hook fires again)
    if (output.system.some((part) => part.includes(ULTRAWORK_MODE_TAG))) return

    const modelID = input.model?.id
    const ultraworkMessage = getUltraworkMessage("sisyphus", modelID)
    if (!ultraworkMessage) return

    output.system.push(ultraworkMessage)
  }
}
