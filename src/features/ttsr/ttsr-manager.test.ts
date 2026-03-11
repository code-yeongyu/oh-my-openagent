/// <reference types="bun-types" />

import { beforeEach, describe, expect, it } from "bun:test"
import { TtsrManager } from "./ttsr-manager"
import type { TtsrRule, TtsrSettings } from "./types"

const defaultSettings: TtsrSettings = {
  enabled: true,
  contextMode: "discard",
  interruptMode: "always",
  repeatMode: "once",
  repeatGap: 10,
  maxRetriesPerRule: 3,
}

const makeRule = (overrides: Partial<TtsrRule> = {}): TtsrRule => ({
  name: "test-rule",
  content: "Do not do this",
  condition: ["to=multi_tool_use"],
  scope: ["text"],
  ...overrides,
})

describe("TtsrManager", () => {
  let manager: TtsrManager

  beforeEach(() => {
    manager = new TtsrManager(defaultSettings)
  })

  describe("#given addRule", () => {
    describe("#when rule added", () => {
      describe("#then", () => {
        it("registers rule and detects pattern in delta", () => {
          manager.addRule(makeRule())
          const matches = manager.checkDelta("to=multi_tool_use.parallel", { source: "text" })
          expect(matches).toHaveLength(1)
          expect(matches[0]?.name).toBe("test-rule")
        })

        it("does not match when pattern absent", () => {
          manager.addRule(makeRule())
          const matches = manager.checkDelta("normal output text", { source: "text" })
          expect(matches).toHaveLength(0)
        })

        it("ignores rules with only invalid regex conditions", () => {
          manager.addRule(makeRule({ condition: ["["] }))
          const matches = manager.checkDelta("to=multi_tool_use", { source: "text" })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })

  describe("#given buffer isolation", () => {
    describe("#when text and tool buffers receive deltas", () => {
      describe("#then", () => {
        it("text buffer is separate from tool buffer", () => {
          manager.addRule(makeRule({ scope: ["text"] }))
          manager.checkDelta("to=multi_tool_use", { source: "tool", toolName: "edit" })
          const matches = manager.checkDelta("", { source: "text" })
          expect(matches).toHaveLength(0)
        })

        it("accumulates delta across multiple calls", () => {
          manager.addRule(makeRule({ condition: ["hello world"] }))
          manager.checkDelta("hello ", { source: "text" })
          const matches = manager.checkDelta("world", { source: "text" })
          expect(matches).toHaveLength(1)
        })

        it("isolates toolcall streamKey buffers", () => {
          manager.addRule(makeRule({ scope: ["tool"], condition: ["abcdef"] }))
          manager.checkDelta("abc", { source: "tool", streamKey: "stream-a" })
          const matches = manager.checkDelta("def", { source: "tool", streamKey: "stream-b" })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })

  describe("#given repeatMode once", () => {
    describe("#when rule triggered twice", () => {
      describe("#then", () => {
        it("does not re-trigger after markInjected", () => {
          manager.addRule(makeRule())
          const first = manager.checkDelta("to=multi_tool_use", { source: "text" })
          expect(first).toHaveLength(1)
          manager.markInjected(["test-rule"])
          manager.resetBuffer()
          const second = manager.checkDelta("to=multi_tool_use", { source: "text" })
          expect(second).toHaveLength(0)
        })
      })
    })
  })

  describe("#given repeatMode after-gap", () => {
    describe("#when enough turns have passed", () => {
      describe("#then", () => {
        it("re-triggers after repeatGap turns", () => {
          const mgr = new TtsrManager({ ...defaultSettings, repeatMode: "after-gap", repeatGap: 2 })
          mgr.addRule(makeRule())
          mgr.checkDelta("to=multi_tool_use", { source: "text" })
          mgr.markInjected(["test-rule"])
          mgr.resetBuffer()
          mgr.incrementMessageCount()
          mgr.incrementMessageCount()
          const matches = mgr.checkDelta("to=multi_tool_use", { source: "text" })
          expect(matches).toHaveLength(1)
        })

        it("does not re-trigger before repeatGap turns", () => {
          const mgr = new TtsrManager({ ...defaultSettings, repeatMode: "after-gap", repeatGap: 5 })
          mgr.addRule(makeRule())
          mgr.checkDelta("to=multi_tool_use", { source: "text" })
          mgr.markInjected(["test-rule"])
          mgr.resetBuffer()
          mgr.incrementMessageCount()
          const matches = mgr.checkDelta("to=multi_tool_use", { source: "text" })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })

  describe("#given resetBuffer", () => {
    describe("#when buffer reset", () => {
      describe("#then", () => {
        it("clears accumulated buffer", () => {
          manager.addRule(makeRule({ condition: ["hello world"] }))
          manager.checkDelta("hello ", { source: "text" })
          manager.resetBuffer()
          const matches = manager.checkDelta("world", { source: "text" })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })

  describe("#given multiple rules", () => {
    describe("#when both match simultaneously", () => {
      describe("#then", () => {
        it("returns all matching rules", () => {
          manager.addRule(makeRule({ name: "rule-a", condition: ["pattern_a"] }))
          manager.addRule(makeRule({ name: "rule-b", condition: ["pattern_b"] }))
          const matches = manager.checkDelta("pattern_a and pattern_b", { source: "text" })
          expect(matches).toHaveLength(2)
          const names = matches.map((rule) => rule.name)
          expect(names).toContain("rule-a")
          expect(names).toContain("rule-b")
        })
      })
    })
  })

  describe("#given disabled settings", () => {
    describe("#when enabled is false", () => {
      describe("#then", () => {
        it("returns empty matches regardless of pattern", () => {
          const mgr = new TtsrManager({ ...defaultSettings, enabled: false })
          mgr.addRule(makeRule())
          const matches = mgr.checkDelta("to=multi_tool_use", { source: "text" })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })

  describe("#given getInjectedRuleNames", () => {
    describe("#when rules injected", () => {
      describe("#then", () => {
        it("returns names of injected rules", () => {
          manager.markInjected(["rule-a", "rule-b"])
          expect(manager.getInjectedRuleNames()).toContain("rule-a")
          expect(manager.getInjectedRuleNames()).toContain("rule-b")
        })
      })
    })
  })

  describe("#given restoreInjected", () => {
    describe("#when restoring session state", () => {
      describe("#then", () => {
        it("prevents re-trigger for restored rules in once mode", () => {
          manager.addRule(makeRule())
          manager.restoreInjected(["test-rule"])
          const matches = manager.checkDelta("to=multi_tool_use", { source: "text" })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })

  describe("#given global globs", () => {
    describe("#when file path does not match", () => {
      describe("#then", () => {
        it("does not match rule even if regex condition matches", () => {
          manager.addRule(makeRule({ scope: ["tool"], globs: ["*.ts"] }))
          const matches = manager.checkDelta("to=multi_tool_use", {
            source: "tool",
            toolName: "edit",
            filePaths: ["src/file.rs"],
          })
          expect(matches).toHaveLength(0)
        })
      })
    })
  })
})
