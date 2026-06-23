/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { buildToolCallsInstructionBlock } from "./prompt"
import type { ToolDefinition, ToolChoice } from "../schemas"

const SAMPLE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get current UTC time as ISO string",
    parameters: { type: "object", properties: {} },
  },
}

const SECOND_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
}

describe("buildToolCallsInstructionBlock", () => {
  describe("#given a single tool and tool_choice 'auto'", () => {
    test("#when block is built #then it lists the tool name and DSML envelope", () => {
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL], "auto")
      expect(block).toContain("get_current_time")
      expect(block).toContain("<|DSML|tool_calls>")
      expect(block).toContain("<|DSML|invoke")
      expect(block).toContain("<|DSML|parameter")
    })
  })

  describe("#given multiple tools", () => {
    test("#when block is built #then JSON contains both tool names", () => {
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL, SECOND_TOOL], "auto")
      expect(block).toContain("get_current_time")
      expect(block).toContain("search_web")
    })
  })

  describe("#given the anti-prose DSML rule", () => {
    test("#when block is built #then the rule is present near the top", () => {
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL], "auto")
      const antiProseRule =
        "IMPORTANT: DSML markup is NEVER for demonstration, examples, or showing code to the user."
      expect(block).toContain(antiProseRule)
      expect(block.indexOf(antiProseRule)).toBeLessThan(
        block.indexOf("Never place the DSML block inside Markdown code fences."),
      )
    })
  })

  describe("#given undefined tool_choice", () => {
    test("#when block is built #then no specific-name constraint mentioned", () => {
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL], undefined)
      expect(block).toContain("get_current_time")
      expect(block).not.toContain("must call only")
    })
  })

  describe("#given tool_choice 'required'", () => {
    test("#when block is built #then mandatory call rule appears", () => {
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL], "required")
      expect(block.toLowerCase()).toContain("must call")
    })
  })

  describe("#given tool_choice {type:'function', function:{name:'get_current_time'}}", () => {
    test("#when block is built #then the specific name is anchored", () => {
      const tc: ToolChoice = {
        type: "function",
        function: { name: "get_current_time" },
      }
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL], tc)
      expect(block).toContain("get_current_time")
      expect(block.toLowerCase()).toContain("only")
    })
  })

  describe("#given an example block requirement", () => {
    test("#when block is built #then at least two example invocations appear", () => {
      const block = buildToolCallsInstructionBlock([SAMPLE_TOOL, SECOND_TOOL], "auto")
      const occurrences = block.match(/<\|DSML\|invoke/g) ?? []
      expect(occurrences.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("#given empty tool list", () => {
    test("#when block is built #then result is empty string", () => {
      const block = buildToolCallsInstructionBlock([], "auto")
      expect(block).toBe("")
    })
  })
})
