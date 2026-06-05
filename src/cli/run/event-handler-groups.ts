import type { EventState } from "./event-state"
import {
  handleMessagePartDelta,
  handleMessagePartUpdated,
  handleMessageUpdated,
} from "./event-message-handlers"
import { handleSessionError, handleSessionIdle, handleSessionStatus } from "./event-session-handlers"
import { handleTuiToast } from "./event-toast-handlers"
import { handleToolExecute, handleToolResult } from "./event-tool-handlers"
import type { EventPayload, RunContext } from "./types"

export type EventHandler = (
  ctx: RunContext,
  payload: EventPayload,
  state: EventState,
) => void

export const sessionEventHandlers = [
  handleSessionError,
  handleSessionIdle,
  handleSessionStatus,
] as const satisfies readonly EventHandler[]

export const messageEventHandlers = [
  handleMessagePartUpdated,
  handleMessagePartDelta,
  handleMessageUpdated,
] as const satisfies readonly EventHandler[]

export const toolEventHandlers = [
  handleToolExecute,
  handleToolResult,
] as const satisfies readonly EventHandler[]

export const toastEventHandlers = [
  handleTuiToast,
] as const satisfies readonly EventHandler[]

export const eventHandlers = [
  ...sessionEventHandlers,
  ...messageEventHandlers,
  ...toolEventHandlers,
  ...toastEventHandlers,
] as const satisfies readonly EventHandler[]
