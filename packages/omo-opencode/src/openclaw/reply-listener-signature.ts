import type { OpenClawConfig } from "./types"

export function getReplyListenerRuntimeSignature(config: Pick<OpenClawConfig, "replyListener"> | null): string {
  return JSON.stringify(config?.replyListener ?? null)
}
