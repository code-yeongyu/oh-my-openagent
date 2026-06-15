import type { DefaultModeConfig } from "../config/schema/default-mode"
import {
  GPT_APPLY_PATCH_GUIDANCE,
  GPT_FILE_EDIT_GUIDANCE,
} from "../agents/gpt-apply-patch-guard"
import { isGptModel } from "../agents/types"
import {
  getSparkShellRuntimeAwareness,
  hasSparkShellRuntimeAwareness,
} from "../shared/sparkshell-awareness"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

/**
 * The Sisyphus prompt body (incl. the file-edit guidance) is baked into the
 * agent config at registration time, based on the *configured* model in
 * `oh-my-openagent.jsonc`. When the user switches to a different model family in
 * the TUI, that baked guidance no longer matches the runtime model — e.g. a
 * GPT-configured agent run on a non-GPT model still says "Use `apply_patch`",
 * even though `apply_patch` is not exposed (issue #5297).
 *
 * The system-transform hook is the only per-request seam that knows the model
 * actually selected at runtime, so reconcile the file-edit guidance here to
 * match the runtime family rather than the configured one.
 */
function reconcileFileEditGuidance(
  system: string[],
  modelID: string | undefined,
): void {
  if (!modelID) return

  const [from, to] = isGptModel(modelID)
    ? [GPT_FILE_EDIT_GUIDANCE, GPT_APPLY_PATCH_GUIDANCE]
    : [GPT_APPLY_PATCH_GUIDANCE, GPT_FILE_EDIT_GUIDANCE]

  for (let i = 0; i < system.length; i++) {
    const part = system[i]
    if (part.includes(from)) {
      system[i] = part.split(from).join(to)
    }
  }
}

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
    reconcileFileEditGuidance(output.system, input.model?.id)

    const sparkshellAwareness = getSparkShellRuntimeAwareness(env)
    if (
      sparkshellAwareness.length > 0 &&
      !output.system.some(hasSparkShellRuntimeAwareness)
    ) {
      output.system.push(sparkshellAwareness)
    }

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
