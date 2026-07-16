import type { DefaultModeConfig } from "../config/schema/default-mode"
import type { BackgroundManager } from "../features/background-agent"
import { reconcileSisyphusRuntimePrompt } from "../agents/sisyphus-runtime-prompt-reconciler"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

const BACKGROUND_WAIT_TAG = "[CRITICAL — BACKGROUND TASKS RUNNING]"

const BACKGROUND_WAIT_INSTRUCTION = `<system-reminder>
${BACKGROUND_WAIT_TAG}
You have background tasks that are still running or pending. You MUST call the \`wait-for-background-tasks\` tool BEFORE ending your turn. If you end your turn without calling it, the session may be terminated and all background work lost.

Do NOT end your turn with a text response while background tasks are active. Instead:
1. Call \`wait-for-background-tasks\` to block until all tasks finish, the wait times out, or the call is aborted
2. Process the results
3. Then provide your final response
</system-reminder>`

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
  options?: {
    backgroundManager?: Pick<BackgroundManager, "hasActiveDescendantTasks">
    blockOnBackgroundTasks?: boolean
  },
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

    injectBackgroundWaitInstruction(input.sessionID, output.system, options)

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

function injectBackgroundWaitInstruction(
  sessionID: string | undefined,
  system: string[],
  options:
    | { backgroundManager?: Pick<BackgroundManager, "hasActiveDescendantTasks">; blockOnBackgroundTasks?: boolean }
    | undefined,
): void {
  if (!options?.blockOnBackgroundTasks || !options.backgroundManager || !sessionID) return
  if (!options.backgroundManager.hasActiveDescendantTasks(sessionID)) return
  if (system.some((part) => part.includes(BACKGROUND_WAIT_TAG))) return
  system.push(BACKGROUND_WAIT_INSTRUCTION)
}
