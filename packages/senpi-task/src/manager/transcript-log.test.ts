import { describe, expect, test } from "bun:test"

import type { PersistedTaskEvent } from "../store"
import type { ManagedChildEvent, ManagedChildHandle } from "./child-handle"
import { TRANSCRIPT_ASSISTANT_EVENT, TRANSCRIPT_TOOL_EVENT, logTranscriptEvent, subscribeTranscriptLog } from "./transcript-log"

type Appended = { readonly taskId: string; readonly event: PersistedTaskEvent }

function recordingStore(): { readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string; readonly appended: Appended[] } {
  const appended: Appended[] = []
  return {
    appended,
    appendEvent: (taskId, event) => {
      appended.push({ taskId, event })
      return `/logs/${taskId}.jsonl`
    },
  }
}

const assistantEnd: ManagedChildEvent = {
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text: "done reasoning" }] },
}

describe("logTranscriptEvent", () => {
  test("#given an assistant message_end #when logged #then an assistant transcript event is appended with the text", () => {
    // given
    const store = recordingStore()

    // when
    logTranscriptEvent(store, "st_1", assistantEnd)

    // then
    expect(store.appended.length).toBe(1)
    expect(store.appended[0]?.event.type).toBe(TRANSCRIPT_ASSISTANT_EVENT)
    expect(store.appended[0]?.event.payload).toEqual({ text: "done reasoning" })
  })

  test("#given a tool_execution_end #when logged #then a tool transcript event is appended with the tool name and error flag", () => {
    // given
    const store = recordingStore()
    const event: ManagedChildEvent = { type: "tool_execution_end", toolName: "bash", result: "ok", isError: false }

    // when
    logTranscriptEvent(store, "st_1", event)

    // then
    expect(store.appended[0]?.event.type).toBe(TRANSCRIPT_TOOL_EVENT)
    expect(store.appended[0]?.event.payload).toEqual({ tool: "bash", is_error: false })
  })

  test("#given a non-assistant message_end #when logged #then nothing is appended", () => {
    // given
    const store = recordingStore()
    const event: ManagedChildEvent = {
      type: "message_end",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    }

    // when
    logTranscriptEvent(store, "st_1", event)

    // then
    expect(store.appended.length).toBe(0)
  })

  test("#given an unrelated event type #when logged #then nothing is appended", () => {
    // given
    const store = recordingStore()

    // when
    logTranscriptEvent(store, "st_1", { type: "queue_update" })
    logTranscriptEvent(store, "st_1", { type: "tool_execution_start", toolName: "bash" })

    // then
    expect(store.appended.length).toBe(0)
  })
})

describe("subscribeTranscriptLog", () => {
  test("#given a handle #when subscribed #then transcript events flow into the store and the unsubscribe is returned", () => {
    // given
    const store = recordingStore()
    let listener: ((event: ManagedChildEvent) => void) | undefined
    let unsubscribed = false
    const handle = {
      subscribe(next: (event: ManagedChildEvent) => void) {
        listener = next
        return () => {
          unsubscribed = true
        }
      },
    } as unknown as ManagedChildHandle

    // when
    const unsubscribe = subscribeTranscriptLog(handle, store, "st_2")
    listener?.(assistantEnd)
    unsubscribe()

    // then
    expect(store.appended.length).toBe(1)
    expect(store.appended[0]?.taskId).toBe("st_2")
    expect(unsubscribed).toBe(true)
  })
})

describe("logTranscriptEvent child errors", () => {
  test("#given an assistant message_end carrying a stopReason error #when logged #then a child_error transcript event is appended with the diagnostic", () => {
    // given a provider failure surfaced as an assistant message with stopReason error
    const store = recordingStore()
    const event: ManagedChildEvent = {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "upstream gateway timeout" },
    }

    // when
    logTranscriptEvent(store, "st_3", event)

    // then the failure leaves a transcript breadcrumb instead of vanishing
    expect(store.appended.length).toBe(1)
    expect(store.appended[0]?.event.type).toBe("child_error")
    expect(store.appended[0]?.event.payload).toEqual({ message: "upstream gateway timeout", stop_reason: "error" })
  })
})
