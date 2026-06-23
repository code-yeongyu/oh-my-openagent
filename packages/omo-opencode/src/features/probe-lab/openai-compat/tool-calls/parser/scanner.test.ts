import { describe, expect, test } from "bun:test"
import { findCandidateBlocks } from "./scanner"

describe("findCandidateBlocks", () => {
  describe("#given canonical DSML wrapper", () => {
    test("#when scanned #then one block returned with normalized canonical body", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="x"><|DSML|parameter name="y">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<|DSML|tool_calls>")
      expect(blocks[0]!.normalized).toContain("</|DSML|tool_calls>")
      expect(blocks[0]!.normalized).toContain('<|DSML|invoke name="x">')
    })
  })

  describe("#given missing leading pipe in opening tag <DSML|tool_calls>", () => {
    test("#when scanned #then opener normalized to <|DSML|tool_calls>", () => {
      const text = `<DSML|tool_calls>
<DSML|invoke name="x"><DSML|parameter name="y">1</DSML|parameter></DSML|invoke>
</DSML|tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<|DSML|tool_calls>")
      expect(blocks[0]!.normalized).toContain('<|DSML|invoke name="x">')
      expect(blocks[0]!.normalized).toContain('<|DSML|parameter name="y">')
    })
  })

  describe("#given extra leading angle <<|DSML|tool_calls>", () => {
    test("#when scanned #then opener still recognized and normalized", () => {
      const text = `<<|DSML|tool_calls>
<|DSML|invoke name="x"><|DSML|parameter name="y">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized.startsWith("<|DSML|tool_calls>")).toBe(true)
    })
  })

  describe("#given missing inner pipe <|DSML tool_calls>", () => {
    test("#when scanned #then opener normalized to <|DSML|tool_calls>", () => {
      const text = `<|DSML tool_calls>
<|DSML invoke name="x"><|DSML parameter name="y">1</|DSML parameter></|DSML invoke>
</|DSML tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<|DSML|tool_calls>")
      expect(blocks[0]!.normalized).toContain('<|DSML|invoke name="x">')
      expect(blocks[0]!.normalized).toContain('<|DSML|parameter name="y">')
    })
  })

  describe("#given fully concatenated <|DSMLtool_calls>", () => {
    test("#when scanned #then opener normalized to <|DSML|tool_calls>", () => {
      const text = `<|DSMLtool_calls>
<|DSMLinvoke name="x"><|DSMLparameter name="y">1</|DSMLparameter></|DSMLinvoke>
</|DSMLtool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<|DSML|tool_calls>")
      expect(blocks[0]!.normalized).toContain('<|DSML|invoke name="x">')
    })
  })

  describe("#given heavily mangled <DSMLtool_calls>", () => {
    test("#when scanned #then opener normalized", () => {
      const text = `<DSMLtool_calls>
<DSMLinvoke name="x"><DSMLparameter name="y">1</DSMLparameter></DSMLinvoke>
</DSMLtool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<|DSML|tool_calls>")
    })
  })

  describe("#given trailing extra pipe <|DSML|tool_calls|>", () => {
    test("#when scanned #then opener normalized", () => {
      const text = `<|DSML|tool_calls|>
<|DSML|invoke name="x"><|DSML|parameter name="y">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls|>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<|DSML|tool_calls>")
    })
  })

  describe("#given DSML wrapped inside fenced ``` block", () => {
    test("#when scanned #then NO candidate block returned", () => {
      const text = "Here is an example:\n```\n<|DSML|tool_calls>\n<|DSML|invoke name=\"x\"><|DSML|parameter name=\"y\">1</|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls>\n```\nMakes sense?"
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(0)
    })
  })

  describe("#given DSML wrapped inside fenced ~~~ block", () => {
    test("#when scanned #then NO candidate block returned", () => {
      const text = "Here is an example:\n~~~\n<|DSML|tool_calls>\n<|DSML|invoke name=\"x\"><|DSML|parameter name=\"y\">1</|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls>\n~~~\nMakes sense?"
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(0)
    })
  })

  describe("#given DSML mixed with prose outside any fences", () => {
    test("#when scanned #then prose ignored, only DSML returned", () => {
      const text = `Sure, calling now: <|DSML|tool_calls>
<|DSML|invoke name="get_time"><|DSML|parameter name="tz"><![CDATA[UTC]]></|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls> done.`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("get_time")
    })
  })

  describe("#given content with no DSML at all", () => {
    test("#when scanned #then empty array returned", () => {
      const blocks = findCandidateBlocks("Plain prose with no markers, just text.")
      expect(blocks.length).toBe(0)
    })
  })

  describe("#given two DSML blocks in one content", () => {
    test("#when scanned #then both blocks returned in order", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="a"><|DSML|parameter name="x">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>
prose between
<|DSML|tool_calls>
<|DSML|invoke name="b"><|DSML|parameter name="y">2</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(2)
      expect(blocks[0]!.normalized).toContain('name="a"')
      expect(blocks[1]!.normalized).toContain('name="b"')
    })
  })

  describe("#given legacy <tool_calls> wrapper", () => {
    test("#when scanned #then legacy form recognized too", () => {
      const text = `<tool_calls>
<invoke name="x"><parameter name="y">1</parameter></invoke>
</tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("<tool_calls>")
      expect(blocks[0]!.normalized).toContain('<invoke name="x">')
    })
  })

  describe("#given DSML inside fenced code AND a separate DSML outside", () => {
    test("#when scanned #then only the outside block returned", () => {
      const text =
        "Example:\n```\n<|DSML|tool_calls>\n<|DSML|invoke name=\"in_fence\"></|DSML|invoke>\n</|DSML|tool_calls>\n```\n\nNow really call: <|DSML|tool_calls>\n<|DSML|invoke name=\"real_call\"><|DSML|parameter name=\"x\">1</|DSML|parameter></|DSML|invoke>\n</|DSML|tool_calls>"
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.normalized).toContain("real_call")
      expect(blocks[0]!.normalized).not.toContain("in_fence")
    })
  })

  describe("#given start/end positions", () => {
    test("#when scanned #then block start/end indexes are non-negative and consistent", () => {
      const text = `<|DSML|tool_calls>
<|DSML|invoke name="x"><|DSML|parameter name="y">1</|DSML|parameter></|DSML|invoke>
</|DSML|tool_calls>`
      const blocks = findCandidateBlocks(text)
      expect(blocks.length).toBe(1)
      expect(blocks[0]!.start).toBeGreaterThanOrEqual(0)
      expect(blocks[0]!.end).toBeGreaterThan(blocks[0]!.start)
    })
  })
})
