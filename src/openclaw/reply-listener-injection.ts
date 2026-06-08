import { removeMessagesByPane } from "./session-registry"
import { analyzePaneContent, captureTmuxPane, sendToPane } from "./tmux"
import { logReplyListenerMessage } from "./reply-listener-log"
import type { OpenClawConfig } from "./types"

export function sanitizeReplyInput(text: string): string {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\(/g, "\\$(")
    .replace(/\$\{/g, "\\${")
    .trim()
}

export class ReplyListenerRateLimiter {
  private readonly maxPerMinute: number
  private readonly timestamps: number[] = []
  private readonly windowMs = 60 * 1000

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute
  }

  canProceed(): boolean {
    const now = Date.now()
    const recent = this.timestamps.filter((timestamp) => now - timestamp < this.windowMs)
    this.timestamps.length = 0
    this.timestamps.push(...recent)

    if (this.timestamps.length >= this.maxPerMinute) {
      return false
    }

    this.timestamps.push(now)
    return true
  }
}

export async function injectReplyIntoPane(
  paneId: string,
  text: string,
  platform: string,
  config: OpenClawConfig,
): Promise<boolean> {
  const replyListener = config.replyListener
  const content = await captureTmuxPane(paneId, 15)
  const analysis = analyzePaneContent(content)

  if (analysis.confidence < 0.3) {
    logReplyListenerMessage(
      `WARN: Pane ${paneId} does not appear to be running OpenCode CLI (confidence: ${analysis.confidence}). Skipping injection, removing stale mapping.`,
    )
    removeMessagesByPane(paneId)
    return false
  }

  const prefix = replyListener?.includePrefix === false ? "" : `[reply:${platform}] `
  const sanitized = sanitizeReplyInput(prefix + text)
  const truncated = sanitized.slice(0, replyListener?.maxMessageLength ?? 500)
  const success = await sendToPane(paneId, truncated, true)

  if (success) {
    logReplyListenerMessage(
      `Injected reply from ${platform} into pane ${paneId}: "${truncated.slice(0, 50)}${truncated.length > 50 ? "..." : ""}"`,
    )
  } else {
    logReplyListenerMessage(`ERROR: Failed to inject reply into pane ${paneId}`)
  }

  return success
}
