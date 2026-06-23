import { describe, expect, test } from "bun:test"
import { parseDsmlToolCalls } from "./parser"

// V0.9.2 baseline regression set — every fixture in this file must
// continue to pass in V0.9.3+ as the parser is split into sub-modules
// (scanner / cdata / fenced-code / leak-reparser). Do not remove or
// weaken these assertions; add new fixtures, do not delete old ones.
describe("parseDsmlToolCalls", () => {
  describe("#given a single DSML invoke with CDATA string arg", () => {
    test("#when parsed #then one call with string-typed arg", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="get_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.sawSyntax).toBe(true)
      expect(r.calls.length).toBe(1)
      expect(r.calls[0]!.name).toBe("get_time")
      expect(r.calls[0]!.arguments).toEqual({ tz: "UTC" })
    })
  })

  describe("#given the legacy <tool_calls> form", () => {
    test("#when parsed #then call is recognized too", () => {
      const text = `<tool_calls>
<invoke name="get_time">
<parameter name="tz"><![CDATA[UTC]]></parameter>
</invoke>
</tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.sawSyntax).toBe(true)
      expect(r.calls.length).toBe(1)
      expect(r.calls[0]!.name).toBe("get_time")
      expect(r.calls[0]!.arguments).toEqual({ tz: "UTC" })
    })
  })

  describe("#given a numeric parameter", () => {
    test("#when parsed #then arg is typed as number", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="set_temp">
<|DSML|parameter name="value">42</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls[0]!.arguments).toEqual({ value: 42 })
    })
  })

  describe("#given a boolean parameter", () => {
    test("#when parsed #then arg is typed as boolean", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="set_flag">
<|DSML|parameter name="enabled">true</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls[0]!.arguments).toEqual({ enabled: true })
    })
  })

  describe("#given a null parameter", () => {
    test("#when parsed #then arg is null", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="reset_field">
<|DSML|parameter name="value">null</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls[0]!.arguments).toEqual({ value: null })
    })
  })

  describe("#given an invoke with no parameters at all", () => {
    test("#when parsed #then it is filtered out", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="empty">
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls.length).toBe(0)
      expect(r.sawSyntax).toBe(false)
    })
  })

  describe("#given malformed XML (no closing wrapper)", () => {
    test("#when parsed #then no calls returned, sawSyntax false", () => {
      const text = `<|DSML|tool_calls><|DSML|invoke name="x">`
      const r = parseDsmlToolCalls(text)
      expect(r.calls.length).toBe(0)
      expect(r.sawSyntax).toBe(false)
    })
  })

  describe("#given two invoke blocks under one wrapper", () => {
    test("#when parsed #then both calls returned", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="a">
<|DSML|parameter name="x"><![CDATA[1]]></|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="b">
<|DSML|parameter name="y">2</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls.length).toBe(2)
      expect(r.calls[0]!.name).toBe("a")
      expect(r.calls[0]!.arguments).toEqual({ x: "1" })
      expect(r.calls[1]!.name).toBe("b")
      expect(r.calls[1]!.arguments).toEqual({ y: 2 })
    })
  })

  describe("#given parameter with multi-line CDATA (newlines, quotes)", () => {
    test("#when parsed #then content preserved verbatim", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="run">
<|DSML|parameter name="cmd"><![CDATA[echo "hi"
echo "bye"]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls[0]!.arguments).toEqual({
        cmd: 'echo "hi"\necho "bye"',
      })
    })
  })

  describe("#given plain prose with no tool block", () => {
    test("#when parsed #then no calls and sawSyntax false", () => {
      const r = parseDsmlToolCalls("Hello, the answer is 42.")
      expect(r.calls.length).toBe(0)
      expect(r.sawSyntax).toBe(false)
    })
  })

  describe("#given negative number parameter", () => {
    test("#when parsed #then arg is negative number", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="x">
<|DSML|parameter name="n">-3.14</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls[0]!.arguments).toEqual({ n: -3.14 })
    })
  })

  describe("#given a long history with interleaved assistant text and 5 sequential tool_calls", () => {
    test("#when only the latest assistant turn (DSML wrapper) is parsed #then both calls in that wrapper are returned", () => {
      const text = `Turn 1 user: "Get the time."
Turn 1 assistant prose: "Sure, calling now."
[old tool_calls block from turn 1 — NOT in current parse target]
Turn 2 user: "Now also search the web for 'bun'."
Turn 2 assistant: <|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="search_web">
<|DSML|parameter name="query"><![CDATA[bun]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls.length).toBe(2)
      expect(r.calls[0]!.name).toBe("get_current_time")
      expect(r.calls[0]!.arguments).toEqual({ tz: "UTC" })
      expect(r.calls[1]!.name).toBe("search_web")
      expect(r.calls[1]!.arguments).toEqual({ query: "bun" })
    })
  })

  describe("#given multi-turn assistant content with 5 separate DSML wrappers (one per turn)", () => {
    test("#when parsed #then all calls across all wrappers are flattened in order", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="t1"><|DSML|parameter name="x">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>
prose
<|DSML|tool_calls>
<|DSML|invoke name="t2"><|DSML|parameter name="x">2</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>
more
<|DSML|tool_calls>
<|DSML|invoke name="t3"><|DSML|parameter name="x">3</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>
even more
<|DSML|tool_calls>
<|DSML|invoke name="t4"><|DSML|parameter name="x">4</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>
last
<|DSML|tool_calls>
<|DSML|invoke name="t5"><|DSML|parameter name="x">5</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls.length).toBe(5)
      expect(r.calls.map((c) => c.name)).toEqual(["t1", "t2", "t3", "t4", "t5"])
    })
  })

  describe("#given DSML noise wrapper variant (concatenated <|DSMLtool_calls>)", () => {
    test("#when parsed #then noise variant still recognized", () => {
      const text = `<|DSMLtool_calls>
<|DSMLinvoke name="x"><|DSMLparameter name="y">1</|DSMLparameter></|DSMLinvoke>
</|DSMLtool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.sawSyntax).toBe(true)
      expect(r.calls.length).toBe(1)
      expect(r.calls[0]!.name).toBe("x")
    })
  })

  describe("#given DSML inside fenced ``` block", () => {
    test("#when parsed #then NO calls returned (fenced exclusion)", () => {
      const text = "ex\n```\n<|DSML|tool_calls>\n<|DSML|invoke name=\"x\"><|DSML|parameter name=\"y\">1</|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls>\n```\n"
      const r = parseDsmlToolCalls(text)
      expect(r.calls.length).toBe(0)
      expect(r.sawSyntax).toBe(false)
    })
  })

  describe("#given parameter with split CDATA (]]> bridge)", () => {
    test("#when parsed #then bridged value reassembled with literal ]]> in middle", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="x">
<|DSML|parameter name="v"><![CDATA[a]]]]><![CDATA[>b]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = parseDsmlToolCalls(text)
      expect(r.calls[0]!.arguments).toEqual({ v: "a]]>b" })
    })
  })
})
