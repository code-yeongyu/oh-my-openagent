import { describe, expect, test } from "bun:test"
import {
  fakeFinishedSseLegacyContent,
  fakeFinishedSseResponseOnly,
  fakeFinishedSseThinkingOnly,
  fakeFinishedSseWithThinking,
} from "./fragment-fixtures"
import { extractSseBodySignals } from "./sse-body-extractor"

describe("extractSseBodySignals", () => {
  describe("#given an empty body", () => {
    test("#when extracted #then empty_sse=true and counts zero", () => {
      const s = extractSseBodySignals("")
      expect(s.empty_sse).toBe(true)
      expect(s.sse_data_count).toBe(0)
      expect(s.sse_event_count).toBe(0)
      expect(s.terminal_status).toBeNull()
      expect(s.content_text).toBe("")
      expect(s.reasoning_text).toBe("")
      expect(s.response_message_id).toBeNull()
    })
  })

  describe("#given a body with one event line and one data line", () => {
    test("#when extracted #then empty_sse=false and both counts are 1", () => {
      const body = "event: ready\ndata: {}\n\n"
      const s = extractSseBodySignals(body)
      expect(s.empty_sse).toBe(false)
      expect(s.sse_event_count).toBe(1)
      expect(s.sse_data_count).toBe(1)
    })
  })

  describe("#given a body with only event lines and zero data lines", () => {
    test("#when extracted #then empty_sse=false because event_count > 0", () => {
      const body = "event: ready\nevent: update_session\n\n"
      const s = extractSseBodySignals(body)
      expect(s.empty_sse).toBe(false)
      expect(s.sse_event_count).toBe(2)
      expect(s.sse_data_count).toBe(0)
    })
  })

  describe("#given a body whose first frame is a bare {v: string} with no prior p", () => {
    test("#when extracted #then content_text includes the bare v string", () => {
      const body = 'data: {"v":"hello"}\n\n'
      const s = extractSseBodySignals(body)
      expect(s.content_text).toBe("hello")
      expect(s.reasoning_text).toBe("")
      expect(s.empty_sse).toBe(false)
    })
  })

  describe("#given a bare {v: string} after p: response/content (regression)", () => {
    test("#when extracted #then content_text concatenates both frames", () => {
      const body =
        'data: {"p":"response/content","o":"APPEND","v":"hi"}\n\n' +
        'data: {"v":" there"}\n\n'
      const s = extractSseBodySignals(body)
      expect(s.content_text).toBe("hi there")
    })
  })

  describe("#given a legacy thinking-off body", () => {
    test("#when extracted #then content_text concatenates and reasoning_text stays empty", () => {
      const s = extractSseBodySignals(fakeFinishedSseLegacyContent())
      expect(s.empty_sse).toBe(false)
      expect(s.content_text).toBe("hello world")
      expect(s.reasoning_text).toBe("")
      expect(s.terminal_status).toBe("FINISHED")
    })
  })

  describe("#given a body with only THINK fragments", () => {
    test("#when extracted #then reasoning_text concatenates and content_text stays empty", () => {
      const s = extractSseBodySignals(fakeFinishedSseThinkingOnly())
      expect(s.reasoning_text).toBe("alphabeta")
      expect(s.content_text).toBe("")
      expect(s.terminal_status).toBe("FINISHED")
      expect(s.response_message_id).toBe(102)
    })
  })

  describe("#given a body with only RESPONSE fragments seeded via initial state", () => {
    test("#when extracted #then content_text concatenates and reasoning_text stays empty", () => {
      const s = extractSseBodySignals(fakeFinishedSseResponseOnly())
      expect(s.reasoning_text).toBe("")
      expect(s.content_text).toBe("alphabeta")
      expect(s.terminal_status).toBe("FINISHED")
    })
  })

  describe("#given a THINK then RESPONSE transition body", () => {
    test("#when extracted #then reasoning_text and content_text are split correctly", () => {
      const s = extractSseBodySignals(fakeFinishedSseWithThinking())
      expect(s.reasoning_text).toBe("我们被问到")
      expect(s.content_text).toBe("园林里。")
      expect(s.terminal_status).toBe("FINISHED")
      expect(s.response_message_id).toBe(101)
    })
  })

  describe("#given a body without a FINISHED terminal", () => {
    test("#when extracted #then terminal_status is null", () => {
      const body =
        'data: {"p":"response/content","o":"APPEND","v":"hi"}\n\n' +
        'data: {"v":" there"}\n\n'
      const s = extractSseBodySignals(body)
      expect(s.terminal_status).toBeNull()
      expect(s.content_text).toBe("hi there")
    })
  })
})
