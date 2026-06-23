/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { reparseLeakedContent } from "./leak-reparser"

describe("reparseLeakedContent", () => {
  describe("#given pure DSML in content (no surrounding prose)", () => {
    test("#when reparsed #then tool_calls extracted and cleanContent is empty", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="get_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = reparseLeakedContent(text)
      expect(r.tool_calls).toBeDefined()
      expect(r.tool_calls!.length).toBe(1)
      expect(r.tool_calls![0]!.name).toBe("get_time")
      expect(r.tool_calls![0]!.arguments).toEqual({ tz: "UTC" })
      expect(r.cleanContent.trim()).toBe("")
    })
  })

  describe("#given DSML with empty invokes only", () => {
    test("#when reparsed #then DSML is stripped and tool_calls is empty", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="get_time"></|DSML|invoke>
</|DSML|tool_calls>`
      const r = reparseLeakedContent(text)
      expect(r.tool_calls).toEqual([])
      expect(r.cleanContent.trim()).toBe("")
    })
  })

  describe("#given DSML with valid and empty invokes mixed", () => {
    test("#when reparsed #then DSML is stripped and only valid calls survive", () => {
      const text = `before <|DSML|tool_calls>
<|DSML|invoke name="get_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="skip_me"></|DSML|invoke>
</|DSML|tool_calls> after`
      const r = reparseLeakedContent(text)
      expect(r.tool_calls).toHaveLength(1)
      expect(r.tool_calls![0]!.name).toBe("get_time")
      expect(r.cleanContent).toContain("before")
      expect(r.cleanContent).toContain("after")
      expect(r.cleanContent).not.toContain("<|DSML|tool_calls>")
    })
  })

  describe("#given multiple DSML blocks with valid and empty invokes", () => {
    test("#when reparsed #then all DSML is stripped and only valid calls survive", () => {
      const text = `lead <|DSML|tool_calls>
<|DSML|invoke name="skip_one"></|DSML|invoke>
</|DSML|tool_calls> middle <|DSML|tool_calls>
<|DSML|invoke name="get_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls> trail <|DSML|tool_calls>
<|DSML|invoke name="skip_two"></|DSML|invoke>
</|DSML|tool_calls>`
      const r = reparseLeakedContent(text)
      expect(r.tool_calls).toHaveLength(1)
      expect(r.tool_calls![0]!.name).toBe("get_time")
      expect(r.cleanContent).toContain("lead")
      expect(r.cleanContent).toContain("middle")
      expect(r.cleanContent).toContain("trail")
      expect(r.cleanContent).not.toContain("<|DSML|tool_calls>")
    })
  })

  describe("#given DSML with prose preamble", () => {
    test("#when reparsed #then tool_calls extracted and prose retained in cleanContent", () => {
      const text = `Sure, calling now: <|DSML|tool_calls>
<|DSML|invoke name="get_time">
<|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`
      const r = reparseLeakedContent(text)
      expect(r.tool_calls!.length).toBe(1)
      expect(r.cleanContent).toContain("Sure, calling now:")
      expect(r.cleanContent).not.toContain("<|DSML|tool_calls>")
      expect(r.cleanContent).not.toContain("get_time")
    })
  })

  describe("#given DSML with prose preamble and trailing prose", () => {
    test("#when reparsed #then both prose sides retained, DSML stripped", () => {
      const text =
        'preamble <|DSML|tool_calls>\n<|DSML|invoke name="x"><|DSML|parameter name="a">1</|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls> trailing'
      const r = reparseLeakedContent(text)
      expect(r.tool_calls!.length).toBe(1)
      expect(r.cleanContent).toContain("preamble")
      expect(r.cleanContent).toContain("trailing")
      expect(r.cleanContent).not.toContain("<|DSML|tool_calls>")
    })
  })

  describe("#given content with no DSML at all", () => {
    test("#when reparsed #then no tool_calls and content returned unchanged", () => {
      const r = reparseLeakedContent("Sono le 14:00 UTC")
      expect(r.tool_calls).toBeUndefined()
      expect(r.cleanContent).toBe("Sono le 14:00 UTC")
    })
  })

  describe("#given DSML inside fenced ``` code", () => {
    test("#when reparsed #then DSML NOT extracted (delegates to fenced-code module)", () => {
      const text =
        "Here is example syntax:\n```\n<|DSML|tool_calls>\n<|DSML|invoke name=\"x\"><|DSML|parameter name=\"a\">1</|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls>\n```\nDoes that help?"
      const r = reparseLeakedContent(text)
      expect(r.tool_calls).toBeUndefined()
      expect(r.cleanContent).toBe(text)
    })
  })

  describe("#given empty input", () => {
    test("#when reparsed #then no calls and empty content", () => {
      const r = reparseLeakedContent("")
      expect(r.tool_calls).toBeUndefined()
      expect(r.cleanContent).toBe("")
    })
  })

  describe("#given two DSML blocks both leaked in content", () => {
    test("#when reparsed #then all calls extracted and both blocks stripped", () => {
      const text = `prose <|DSML|tool_calls>
<|DSML|invoke name="a"><|DSML|parameter name="x">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls> mid <|DSML|tool_calls>
<|DSML|invoke name="b"><|DSML|parameter name="y">2</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls> end`
      const r = reparseLeakedContent(text)
      expect(r.tool_calls!.length).toBe(2)
      expect(r.cleanContent).toContain("prose")
      expect(r.cleanContent).toContain("mid")
      expect(r.cleanContent).toContain("end")
      expect(r.cleanContent).not.toContain("<|DSML|tool_calls>")
    })
  })
})
