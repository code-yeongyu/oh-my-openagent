import type { ParsedToolCall } from "./parser/invoke-extractor"
import {
  createStreamingState,
  endStream,
  processBuffer,
  type StateEvent,
} from "./tool-call-streaming-state"

export type SieveContentEvent = { type: "content"; text: string }
export type SieveToolStartedEvent = {
  type: "tool_call_started"
  index: number
  id: string
  name: string
}
export type SieveToolArgDeltaEvent = {
  type: "tool_call_argument_delta"
  index: number
  argumentsDelta: string
}
export type SieveToolCallEvent = {
  type: "tool_call_complete"
  index: number
  call: ParsedToolCall
}
export type SieveEndEvent = { type: "stream_end" }
export type SieveEvent =
  | SieveContentEvent
  | SieveToolStartedEvent
  | SieveToolArgDeltaEvent
  | SieveToolCallEvent
  | SieveEndEvent

export type StreamSieve = {
  feed(chunk: string): SieveEvent[]
  end(): SieveEvent[]
}

function toSieveEvents(events: ReadonlyArray<StateEvent>): SieveEvent[] {
  return events.slice() as SieveEvent[]
}

export function createStreamSieve(): StreamSieve {
  const state = createStreamingState()
  return {
    feed(chunk: string): SieveEvent[] {
      if (chunk.length === 0) return []
      state.buffer += chunk
      return toSieveEvents(processBuffer(state))
    },
    end(): SieveEvent[] {
      const events: SieveEvent[] = toSieveEvents(endStream(state))
      events.push({ type: "stream_end" })
      return events
    },
  }
}

export async function* collectAll(
  chunks: AsyncIterable<string>,
): AsyncGenerator<SieveEvent, void, void> {
  const sieve = createStreamSieve()
  for await (const chunk of chunks) {
    for (const event of sieve.feed(chunk)) yield event
  }
  for (const event of sieve.end()) yield event
}
