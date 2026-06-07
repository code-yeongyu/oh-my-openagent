import pc from "picocolors"
import type { EventState } from "./event-state"
import { serializeError } from "./event-formatting"
import { getSessionId } from "./event-session-ids"
import type { EventPayload, RunContext, SessionErrorProps, SessionIdleProps, SessionStatusProps } from "./types"

export function handleSessionIdle(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.idle") return

  const props = payload.properties as SessionIdleProps | undefined
  if (getSessionId(props) === ctx.sessionID) {
    state.mainSessionIdle = true
  }
}

export function handleSessionStatus(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.status") return

  const props = payload.properties as SessionStatusProps | undefined
  if (getSessionId(props) !== ctx.sessionID) return

  if (props?.status?.type === "busy") {
    state.mainSessionIdle = false
    state.mainSessionStarted = true
  } else if (props?.status?.type === "idle") {
    state.mainSessionIdle = true
  } else if (props?.status?.type === "retry") {
    state.mainSessionIdle = false
    state.mainSessionStarted = true
  }
}

export function handleSessionError(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.error") return

  const props = payload.properties as SessionErrorProps | undefined
  if (getSessionId(props) === ctx.sessionID) {
    state.mainSessionError = true
    state.lastError = serializeError(props?.error)
    console.error(pc.red(`\n[session.error] ${state.lastError}`))
  }
}
