import { isResidualPartialDsml } from "./stream-sieve-horizon"
import {
  processInsideInvoke,
  processInsideWrapper,
  processOutside,
} from "./tool-call-streaming-handlers"
import type { StateEvent, StreamingState } from "./tool-call-streaming-types"

export type {
  StateContentEvent,
  StateEvent,
  StateToolArgDeltaEvent,
  StateToolCompleteEvent,
  StateToolStartedEvent,
  StreamingState,
} from "./tool-call-streaming-types"

export function createStreamingState(): StreamingState {
  return { mode: "outside", buffer: "", nextIndex: 0, current: null }
}

function stepOnce(state: StreamingState): StateEvent[] {
  if (state.mode === "outside") return processOutside(state)
  if (state.mode === "inside_wrapper") return processInsideWrapper(state)
  return processInsideInvoke(state)
}

export function processBuffer(state: StreamingState): StateEvent[] {
  const events: StateEvent[] = []
  for (let safety = 0; safety < 1024; safety++) {
    const before = state.buffer
    const beforeMode = state.mode
    const stepEvents = stepOnce(state)
    events.push(...stepEvents)
    if (
      state.buffer === before &&
      state.mode === beforeMode &&
      stepEvents.length === 0
    ) {
      break
    }
  }
  return events
}

export function endStream(state: StreamingState): StateEvent[] {
  const events: StateEvent[] = []
  if (state.mode === "outside") {
    if (state.buffer.length > 0 && !isResidualPartialDsml(state.buffer)) {
      events.push({ type: "content", text: state.buffer })
    }
  }
  state.buffer = ""
  state.current = null
  return events
}
