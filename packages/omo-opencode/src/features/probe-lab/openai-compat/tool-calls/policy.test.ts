import { describe, expect, test } from "bun:test"
import {
  applyParallelToolCallsPolicy,
  applyToolChoicePolicy,
} from "./policy"
import type { ParsedToolCall } from "./parser"
import type { ToolChoice } from "../schemas"

const CALL_TIME: ParsedToolCall = {
  name: "get_current_time",
  arguments: { tz: "UTC" },
}
const CALL_SEARCH: ParsedToolCall = {
  name: "search_web",
  arguments: { query: "x" },
}
const CALL_OTHER: ParsedToolCall = {
  name: "other_tool",
  arguments: { v: 1 },
}

describe("applyToolChoicePolicy", () => {
  describe("#given tool_choice undefined", () => {
    test("#when applied #then keeps all calls untouched (auto behaviour)", () => {
      const r = applyToolChoicePolicy([CALL_TIME, CALL_SEARCH], undefined)
      expect(r.kept.length).toBe(2)
      expect(r.filtered).toBe(0)
    })
  })

  describe("#given tool_choice 'auto'", () => {
    test("#when applied #then keeps all calls", () => {
      const r = applyToolChoicePolicy([CALL_TIME, CALL_SEARCH], "auto")
      expect(r.kept.length).toBe(2)
      expect(r.filtered).toBe(0)
    })
  })

  describe("#given tool_choice 'none'", () => {
    test("#when applied #then drops every call", () => {
      const r = applyToolChoicePolicy([CALL_TIME], "none")
      expect(r.kept.length).toBe(0)
      expect(r.filtered).toBe(1)
    })
  })

  describe("#given tool_choice 'required' with at least one call", () => {
    test("#when applied #then keeps every call as-is", () => {
      const r = applyToolChoicePolicy([CALL_TIME, CALL_SEARCH], "required")
      expect(r.kept.length).toBe(2)
      expect(r.filtered).toBe(0)
    })
  })

  describe("#given tool_choice 'required' with empty calls", () => {
    test("#when applied #then surfaces filtered=0 and kept=[] (caller decides retry/error)", () => {
      const r = applyToolChoicePolicy([], "required")
      expect(r.kept.length).toBe(0)
      expect(r.filtered).toBe(0)
    })
  })

  describe("#given tool_choice {type:'function', function:{name:'X'}}", () => {
    test("#when applied #then keeps only matching calls and counts the rest as filtered", () => {
      const tc: ToolChoice = {
        type: "function",
        function: { name: "get_current_time" },
      }
      const r = applyToolChoicePolicy(
        [CALL_TIME, CALL_SEARCH, CALL_OTHER, CALL_TIME],
        tc,
      )
      expect(r.kept.length).toBe(2)
      expect(r.kept.every((c) => c.name === "get_current_time")).toBe(true)
      expect(r.filtered).toBe(2)
    })

    test("#when applied with no matching call #then kept is empty and filtered counts non-matches", () => {
      const tc: ToolChoice = {
        type: "function",
        function: { name: "missing_tool" },
      }
      const r = applyToolChoicePolicy([CALL_TIME, CALL_SEARCH], tc)
      expect(r.kept.length).toBe(0)
      expect(r.filtered).toBe(2)
    })
  })
})

describe("applyParallelToolCallsPolicy", () => {
  describe("#given parallel enabled (true)", () => {
    test("#when applied #then keeps every call (no cap)", () => {
      const r = applyParallelToolCallsPolicy(
        [CALL_TIME, CALL_SEARCH, CALL_OTHER],
        true,
      )
      expect(r.kept.length).toBe(3)
      expect(r.dropped).toBe(0)
    })
  })

  describe("#given parallel enabled (undefined defaulting to true at caller)", () => {
    test("#when called with explicit true #then no cap is applied", () => {
      const r = applyParallelToolCallsPolicy([CALL_TIME, CALL_SEARCH], true)
      expect(r.kept.length).toBe(2)
      expect(r.dropped).toBe(0)
    })
  })

  describe("#given parallel disabled (false) and 2 calls", () => {
    test("#when applied #then keeps the first call and drops the rest in order", () => {
      const r = applyParallelToolCallsPolicy([CALL_TIME, CALL_SEARCH], false)
      expect(r.kept.length).toBe(1)
      expect(r.kept[0]?.name).toBe("get_current_time")
      expect(r.dropped).toBe(1)
    })
  })

  describe("#given parallel disabled (false) and 3 calls", () => {
    test("#when applied #then drops 2", () => {
      const r = applyParallelToolCallsPolicy(
        [CALL_TIME, CALL_SEARCH, CALL_OTHER],
        false,
      )
      expect(r.kept.length).toBe(1)
      expect(r.dropped).toBe(2)
    })
  })

  describe("#given parallel disabled (false) and 0 calls", () => {
    test("#when applied #then kept and dropped are both 0", () => {
      const r = applyParallelToolCallsPolicy([], false)
      expect(r.kept.length).toBe(0)
      expect(r.dropped).toBe(0)
    })
  })

  describe("#given parallel disabled (false) and 1 call", () => {
    test("#when applied #then keeps the single call unchanged", () => {
      const r = applyParallelToolCallsPolicy([CALL_TIME], false)
      expect(r.kept.length).toBe(1)
      expect(r.dropped).toBe(0)
    })
  })
})
