/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type {
  TtsrMatchContext,
  TtsrMatchSource,
  TtsrRule,
  TtsrScope,
  TtsrSettings,
} from "./types"

describe("TtsrTypes", () => {
  describe("#given valid type usage", () => {
    describe("#when constructing TtsrMatchContext", () => {
      describe("#then", () => {
        it("accepts all valid match sources", () => {
          const sources: TtsrMatchSource[] = ["text", "thinking", "tool"]
          expect(sources).toHaveLength(3)
        })

        it("constructs a valid TtsrMatchContext", () => {
          const ctx: TtsrMatchContext = { source: "text" }
          expect(ctx.source).toBe("text")
        })

        it("constructs context with all optional fields", () => {
          const ctx: TtsrMatchContext = {
            source: "tool",
            toolName: "edit",
            filePaths: ["src/foo.ts"],
            streamKey: "toolcall:abc123",
          }
          expect(ctx.toolName).toBe("edit")
        })
      })
    })

    describe("#when constructing TtsrScope", () => {
      describe("#then", () => {
        it("constructs a text-only scope", () => {
          const scope: TtsrScope = {
            allowText: true,
            allowThinking: false,
            allowAnyTool: false,
            toolScopes: [],
          }
          expect(scope.allowText).toBe(true)
          expect(scope.toolScopes).toHaveLength(0)
        })

        it("constructs scope with tool-specific entry", () => {
          const scope: TtsrScope = {
            allowText: false,
            allowThinking: false,
            allowAnyTool: false,
            toolScopes: [{ toolName: "edit", fileGlobs: ["*.ts"] }],
          }
          expect(scope.toolScopes[0]?.toolName).toBe("edit")
          expect(scope.toolScopes[0]?.fileGlobs).toContain("*.ts")
        })
      })
    })

    describe("#when constructing TtsrSettings", () => {
      describe("#then", () => {
        it("accepts all valid contextMode values", () => {
          const s1: TtsrSettings = {
            enabled: true,
            contextMode: "discard",
            interruptMode: "always",
            repeatMode: "once",
            repeatGap: 10,
            maxRetriesPerRule: 3,
          }
          const s2: TtsrSettings = {
            enabled: true,
            contextMode: "keep",
            interruptMode: "never",
            repeatMode: "after-gap",
            repeatGap: 5,
            maxRetriesPerRule: 1,
          }
          expect(s1.contextMode).toBe("discard")
          expect(s2.contextMode).toBe("keep")
        })
      })
    })

    describe("#when constructing TtsrRule", () => {
      describe("#then", () => {
        it("constructs a minimal rule", () => {
          const rule: TtsrRule = {
            name: "no-multi-tool",
            content: "Do not use multi_tool_use",
            condition: ["to=multi_tool_use"],
            scope: ["text"],
          }
          expect(rule.condition).toContain("to=multi_tool_use")
          expect(rule.globs).toBeUndefined()
        })
      })
    })
  })
})
