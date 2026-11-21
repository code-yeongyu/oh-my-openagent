import { recordTokenUsage } from "../hooks/session-token-tracker"

export function onModelCallComplete(
  sessionId: string,
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cost?: number,
): void {
  recordTokenUsage(sessionId, model, provider, inputTokens, outputTokens, cost ?? 0)
}
