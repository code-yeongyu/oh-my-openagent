import type { EventState } from "./event-state"
import type { EventPayload, RunContext, TuiToastShowProps } from "./types"

export function handleTuiToast(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tui.toast.show") return

  const props = payload.properties as TuiToastShowProps & { sessionID?: string; sessionId?: string } | undefined
  const variant = props?.variant ?? "info"

  // Only process toasts for our session (if a session ID is present in the event)
  const toastSessionId = props.sessionID ?? props.sessionId
  if (toastSessionId && toastSessionId !== ctx.sessionID) return

  if (variant === "error") {
    const title = props?.title ? `${props.title}: ` : ""
    const message = props?.message?.trim()
    if (message) {
      state.mainSessionError = true
      state.lastError = `${title}${message}`
    }
  }
}
