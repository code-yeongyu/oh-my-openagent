import type { DefaultModeConfig } from "../config/schema/default-mode"
import {
  getSparkShellRuntimeAwareness,
  hasSparkShellRuntimeAwareness,
} from "../shared/sparkshell-awareness"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
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
