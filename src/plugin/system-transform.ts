import type { Model } from "@opencode-ai/sdk"

export function createSystemTransformHandler(): (
  input: { sessionID?: string; model: Model },
  output: { system: string[] },
)=> Promise<void> {
  return async (): Promise<void> => {}
}
