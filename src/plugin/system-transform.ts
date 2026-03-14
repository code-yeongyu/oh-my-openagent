import { setSessionSystemPrompt } from "../shared/session-system-prompt-state"

export function createSystemTransformHandler(): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
    // Store the system prompt for this session so it can be preserved during model fallbacks
    if (input.sessionID && output.system && output.system.length > 0) {
      const systemPrompt = output.system.join("\n")
      setSessionSystemPrompt(input.sessionID, systemPrompt)
    }
  }
}
