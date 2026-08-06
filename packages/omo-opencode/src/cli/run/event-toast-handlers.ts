import type { EventState } from "./event-state"
import type { EventPayload, RunContext, TuiToastShowProps } from "./types"

export function handleTuiToast(_ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tui.toast.show") return

  const props = payload.properties as TuiToastShowProps | undefined
  const variant = props?.variant ?? "info"

  if (variant === "error") {
    const title = props?.title ? `${props.title}: ` : ""
    const message = props?.message?.trim()
    if (message) {
      state.mainSessionError = true
      state.lastError = `${title}${message}`
    }
  }
}
