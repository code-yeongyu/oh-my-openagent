import { describe, expect, test } from "bun:test"
import {
  formatAssistantToolCallsAsDsml,
  formatToolResultAsDsml,
} from "./history"
import type { ToolCallResponse } from "../schemas"

// V0.9.2 baseline regression set — every fixture in this file must
// continue to pass in V0.9.3+. The DSML history formatter is consumed
// directly by parser.ts via translateMessages → tool-history fixtures
// can drift only by additive change.

const CALL_TIME: ToolCallResponse = {
  id: "call_abc123",
  type: "function",
  function: {
    name: "get_current_time",
    arguments: JSON.stringify({ tz: "UTC" }),
  },
}

const CALL_SEARCH: ToolCallResponse = {
  id: "call_def456",
  type: "function",
  function: {
    name: "search_web",
    arguments: JSON.stringify({ query: "bun runtime", max: 5 }),
  },
}

describe("formatAssistantToolCallsAsDsml (Fixture A: single call)", () => {
  describe("#given a single OpenAI tool_call", () => {
    test("#when formatted #then emits a DSML tool_calls wrapper with one invoke and CDATA-wrapped string args", () => {
      const out = formatAssistantToolCallsAsDsml([CALL_TIME])
      expect(out).toContain("<|DSML|tool_calls>")
      expect(out).toContain("</|DSML|tool_calls>")
      expect(out).toContain('<|DSML|invoke name="get_current_time">')
      expect(out).toContain('<|DSML|parameter name="tz">')
      expect(out).toContain("<![CDATA[UTC]]>")
      expect(out).toContain("</|DSML|invoke>")
      expect(out).toContain("</|DSML|parameter>")
    })
  })
})

describe("formatAssistantToolCallsAsDsml (Fixture B: parallel calls)", () => {
  describe("#given two parallel OpenAI tool_calls", () => {
    test("#when formatted #then emits a single wrapper containing both invokes in order", () => {
      const out = formatAssistantToolCallsAsDsml([CALL_TIME, CALL_SEARCH])
      const wrapperOpenCount = (out.match(/<\|DSML\|tool_calls>/g) ?? []).length
      const wrapperCloseCount = (out.match(/<\/\|DSML\|tool_calls>/g) ?? []).length
      expect(wrapperOpenCount).toBe(1)
      expect(wrapperCloseCount).toBe(1)
      const invokeMatches = out.match(/<\|DSML\|invoke /g) ?? []
      expect(invokeMatches.length).toBe(2)
      const idxTime = out.indexOf("get_current_time")
      const idxSearch = out.indexOf("search_web")
      expect(idxTime).toBeGreaterThan(-1)
      expect(idxSearch).toBeGreaterThan(idxTime)
    })

    test("#when formatted #then numeric / non-string JSON args render as plain text without CDATA", () => {
      const out = formatAssistantToolCallsAsDsml([CALL_SEARCH])
      expect(out).toContain('<|DSML|parameter name="max">5</|DSML|parameter>')
    })
  })
})

describe("formatAssistantToolCallsAsDsml (edge cases)", () => {
  describe("#given empty tool_calls array", () => {
    test("#when formatted #then returns empty string (no wrapper)", () => {
      const out = formatAssistantToolCallsAsDsml([])
      expect(out).toBe("")
    })
  })

  describe("#given a tool_call whose arguments JSON is malformed", () => {
    test("#when formatted #then falls back to a single arg with raw text wrapped in CDATA", () => {
      const broken: ToolCallResponse = {
        id: "call_x",
        type: "function",
        function: { name: "noop", arguments: "{this-is-not-json" },
      }
      const out = formatAssistantToolCallsAsDsml([broken])
      expect(out).toContain('<|DSML|invoke name="noop">')
      expect(out).toContain("<![CDATA[{this-is-not-json]]>")
    })
  })

  describe("#given a tool_call whose arguments JSON is empty/{}", () => {
    test("#when formatted #then emits invoke with no parameter children", () => {
      const empty: ToolCallResponse = {
        id: "call_e",
        type: "function",
        function: { name: "noop", arguments: "{}" },
      }
      const out = formatAssistantToolCallsAsDsml([empty])
      expect(out).toContain('<|DSML|invoke name="noop">')
      expect(out).toContain("</|DSML|invoke>")
      expect(out).not.toContain("<|DSML|parameter")
    })
  })
})

describe("formatToolResultAsDsml (Fixture C: tool result with JSON content)", () => {
  describe("#given a tool result with structured JSON content", () => {
    test("#when formatted #then emits a tool_results wrapper containing one result element with tool_call_id and CDATA content", () => {
      const out = formatToolResultAsDsml({
        tool_call_id: "call_abc123",
        name: "get_current_time",
        content: '{"time":"2026-05-08T17:00:00Z"}',
      })
      expect(out).toContain("<|DSML|tool_results>")
      expect(out).toContain("</|DSML|tool_results>")
      expect(out).toContain('tool_call_id="call_abc123"')
      expect(out).toContain('name="get_current_time"')
      expect(out).toContain('<![CDATA[{"time":"2026-05-08T17:00:00Z"}]]>')
    })
  })

  describe("#given a tool result without name", () => {
    test("#when formatted #then omits the name attribute but keeps tool_call_id", () => {
      const out = formatToolResultAsDsml({
        tool_call_id: "call_x",
        content: "ok",
      })
      expect(out).toContain('tool_call_id="call_x"')
      expect(out).not.toContain('name="')
      expect(out).toContain("<![CDATA[ok]]>")
    })
  })
})

describe("formatToolResultAsDsml (Fixture D: malformed / raw text content)", () => {
  describe("#given a tool result with raw text content containing newlines and quotes", () => {
    test("#when formatted #then content is preserved verbatim inside CDATA", () => {
      const raw = 'line1\n"with quotes"\n<not-xml>'
      const out = formatToolResultAsDsml({
        tool_call_id: "call_r",
        name: "run",
        content: raw,
      })
      expect(out).toContain(`<![CDATA[${raw}]]>`)
    })
  })

  describe("#given a tool result whose content already contains the literal CDATA terminator ]]>", () => {
    test("#when formatted #then the terminator is escaped to prevent CDATA break-out", () => {
      const out = formatToolResultAsDsml({
        tool_call_id: "call_evil",
        content: "before]]>after",
      })
      expect(out).not.toContain("before]]>after]]>")
      expect(out).toContain("before]]]]><![CDATA[>after")
    })
  })

  describe("#given empty content", () => {
    test("#when formatted #then emits an empty CDATA section", () => {
      const out = formatToolResultAsDsml({
        tool_call_id: "call_empty",
        content: "",
      })
      expect(out).toContain("<![CDATA[]]>")
    })
  })
})
