import { describe, expect, test } from "bun:test"
import { transformToolName } from "./tool-name"

type ToolNameCase = readonly [label: string, toolName: string, expected: string]

describe("transformToolName", () => {
  describe("whitespace trimming", () => {
    const cases = [
      ["trims leading whitespace from tool name", " delegate_task", "DelegateTask"],
      ["trims trailing whitespace from tool name", "delegate_task ", "DelegateTask"],
      ["trims both leading and trailing whitespace", " delegate_task ", "DelegateTask"],
      ["applies special mapping after trimming whitespace", " webfetch", "WebFetch"],
      ["handles simple case with leading and trailing spaces", " read ", "Read"],
    ] as const satisfies readonly ToolNameCase[]

    for (const [label, toolName, expected] of cases) {
      test(label, () => {
        // when
        const result = transformToolName(toolName)

        // then
        expect(result).toBe(expected)
      })
    }
  })

  describe("special tool mappings", () => {
    const cases = [
      ["maps webfetch to WebFetch", "webfetch", "WebFetch"],
      ["maps websearch to WebSearch", "websearch", "WebSearch"],
      ["maps todoread to TodoRead", "todoread", "TodoRead"],
      ["maps todowrite to TodoWrite", "todowrite", "TodoWrite"],
    ] as const satisfies readonly ToolNameCase[]

    for (const [label, toolName, expected] of cases) {
      test(label, () => {
        // when
        const result = transformToolName(toolName)

        // then
        expect(result).toBe(expected)
      })
    }
  })

  describe("kebab-case and snake_case conversion", () => {
    const cases = [
      ["converts snake_case to PascalCase", "delegate_task", "DelegateTask"],
      ["converts kebab-case to PascalCase", "call-omo-agent", "CallOmoAgent"],
    ] as const satisfies readonly ToolNameCase[]

    for (const [label, toolName, expected] of cases) {
      test(label, () => {
        // when
        const result = transformToolName(toolName)

        // then
        expect(result).toBe(expected)
      })
    }
  })

  describe("simple capitalization", () => {
    const cases = [
      ["capitalizes simple single-word tool names", "read", "Read"],
      ["preserves capitalization of already capitalized names", "Write", "Write"],
    ] as const satisfies readonly ToolNameCase[]

    for (const [label, toolName, expected] of cases) {
      test(label, () => {
        // when
        const result = transformToolName(toolName)

        // then
        expect(result).toBe(expected)
      })
    }
  })
})
