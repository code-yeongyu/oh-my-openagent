import type { DefaultModeConfig } from "../config/schema/default-mode"
import { reconcileSisyphusRuntimePrompt } from "../agents/sisyphus-runtime-prompt-reconciler"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

/**
 * Collapse the opencode hook model record into the canonical
 * `"<providerID>/<id>"` string used throughout OMO (model ids arrive bare for
 * builtin providers). Ids that already carry a provider prefix pass through
 * unchanged so both hook payload shapes stay comparable.
 */
function toCanonicalModel(
  model: { id: string; providerID: string } | undefined,
): string | undefined {
  if (!model?.id) return undefined
  if (model.id.includes("/") || !model.providerID) return model.id
  return `${model.providerID}/${model.id}`
}

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
    // The Sisyphus prompt body is model-specific and baked at registration
    // from the *configured* model in .omo/omo.jsonc. This per-request hook
    // is the only seam that knows the model actually selected at runtime, so
    // rebuild the whole body for the runtime model here (issue #5297/#6966).
    reconcileSisyphusRuntimePrompt(output.system, toCanonicalModel(input.model))

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
