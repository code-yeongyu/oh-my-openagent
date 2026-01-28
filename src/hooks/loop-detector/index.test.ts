import { describe, expect, test, beforeEach } from "bun:test"
import {
  detectLoop,
  type LoopDetection,
  type ToolCallRecord,
  LOOP_THRESHOLDS,
} from "./index"

describe("loop-detector", () => {
  describe("detectLoop", () => {
    test("returns null when no loop detected", () => {
      //#given
      const history: ToolCallRecord[] = [
        { tool: "read", args: { path: "/a.ts" }, timestamp: 1 },
        { tool: "read", args: { path: "/b.ts" }, timestamp: 2 },
        { tool: "edit", args: { path: "/c.ts" }, timestamp: 3 },
      ]

      //#when
      const result = detectLoop(history)

      //#then
      expect(result).toBeNull()
    })

    test("detects repeated identical tool calls", () => {
      //#given
      const history: ToolCallRecord[] = [
        { tool: "read", args: { path: "/a.ts" }, timestamp: 1 },
        { tool: "read", args: { path: "/a.ts" }, timestamp: 2 },
        { tool: "read", args: { path: "/a.ts" }, timestamp: 3 },
      ]

      //#when
      const result = detectLoop(history)

      //#then
      expect(result).not.toBeNull()
      expect(result?.type).toBe("repeated_call")
      expect(result?.count).toBe(3)
    })

    test("detects error loop pattern", () => {
      //#given
      const history: ToolCallRecord[] = [
        { tool: "edit", args: { path: "/a.ts" }, timestamp: 1, error: "oldString not found" },
        { tool: "edit", args: { path: "/a.ts" }, timestamp: 2, error: "oldString not found" },
      ]

      //#when
      const result = detectLoop(history)

      //#then
      expect(result).not.toBeNull()
      expect(result?.type).toBe("error_loop")
      expect(result?.pattern).toContain("oldString not found")
    })

    test("detects alternating tool pattern (ping-pong loop)", () => {
      //#given
      const history: ToolCallRecord[] = [
        { tool: "read", args: { path: "/a.ts", line: 1 }, timestamp: 1 },
        { tool: "edit", args: { path: "/a.ts", old: "x" }, timestamp: 2 },
        { tool: "read", args: { path: "/a.ts", line: 2 }, timestamp: 3 },
        { tool: "edit", args: { path: "/a.ts", old: "y" }, timestamp: 4 },
        { tool: "read", args: { path: "/a.ts", line: 3 }, timestamp: 5 },
        { tool: "edit", args: { path: "/a.ts", old: "z" }, timestamp: 6 },
      ]

      //#when
      const result = detectLoop(history)

      //#then
      expect(result).not.toBeNull()
      expect(result?.type).toBe("alternating_pattern")
    })

    test("respects threshold for repeated calls", () => {
      //#given
      const history: ToolCallRecord[] = [
        { tool: "read", args: { path: "/a.ts" }, timestamp: 1 },
        { tool: "read", args: { path: "/a.ts" }, timestamp: 2 },
        // Only 2 repeats, threshold is 3
      ]

      //#when
      const result = detectLoop(history)

      //#then
      expect(result).toBeNull()
    })

    test("only considers recent history window", () => {
      //#given
      const oldHistory: ToolCallRecord[] = Array.from({ length: 20 }, (_, i) => ({
        tool: "read",
        args: { path: `/old-${i}.ts` },
        timestamp: i,
      }))
      const recentHistory: ToolCallRecord[] = [
        { tool: "read", args: { path: "/new.ts" }, timestamp: 21 },
        { tool: "edit", args: { path: "/new.ts" }, timestamp: 22 },
      ]
      const history = [...oldHistory, ...recentHistory]

      //#when
      const result = detectLoop(history)

      //#then
      // Should not detect loop from old repeated reads
      expect(result).toBeNull()
    })
  })

  describe("LOOP_THRESHOLDS", () => {
    test("has reasonable default values", () => {
      //#given + #when
      const thresholds = LOOP_THRESHOLDS

      //#then
      expect(thresholds.sameToolCall).toBeGreaterThanOrEqual(3)
      expect(thresholds.sameErrorPattern).toBeGreaterThanOrEqual(2)
      expect(thresholds.historyWindow).toBeGreaterThanOrEqual(10)
    })
  })
})
