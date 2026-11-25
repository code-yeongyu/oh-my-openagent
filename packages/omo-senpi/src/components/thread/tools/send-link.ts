import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import type { DeliveryTarget } from "../gateway/transport"
import { threadLink } from "../thread-link"
import type { ThreadHostView } from "./ports"

/**
 * The link a send's answer carries: another device's row title, escaped (#13304), or this device's session name from the
 * view the send was routed with; with no view (an id the gateway owns needs no lookup) the link has no title.
 */
export function sentThreadLink(threadId: string, current: ThreadHostView | undefined, target: DeliveryTarget): string {
  if (target.kind === "remote") return threadLink(threadId, escapeForDisplay(target.row.title))
  const title = current?.sessions.find((session) => (session.durableSessionId ?? session.sessionId) === threadId)?.name
  return threadLink(threadId, title)
}
