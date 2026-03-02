/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { matchesScope, parseScope } from "./scope-parser"

describe("ScopeParser", () => {
  describe("#given parseScope", () => {
    describe("#when empty array", () => {
      describe("#then", () => {
        it("returns default text-only scope", () => {
          const scope = parseScope([])
          expect(scope.allowText).toBe(true)
          expect(scope.allowThinking).toBe(false)
          expect(scope.allowAnyTool).toBe(false)
          expect(scope.toolScopes).toHaveLength(0)
        })
      })
    })

    describe("#when text token", () => {
      describe("#then", () => {
        it("sets allowText true", () => {
          const scope = parseScope(["text"])
          expect(scope.allowText).toBe(true)
          expect(scope.allowThinking).toBe(false)
          expect(scope.allowAnyTool).toBe(false)
        })
      })
    })

    describe("#when thinking token", () => {
      describe("#then", () => {
        it("sets allowThinking true", () => {
          const scope = parseScope(["thinking"])
          expect(scope.allowThinking).toBe(true)
          expect(scope.allowText).toBe(false)
        })
      })
    })

    describe("#when tool token", () => {
      describe("#then", () => {
        it("sets allowAnyTool true", () => {
          const scope = parseScope(["tool"])
          expect(scope.allowAnyTool).toBe(true)
        })
      })
    })

    describe("#when tool:name token", () => {
      describe("#then", () => {
        it("adds named tool scope without globs", () => {
          const scope = parseScope(["tool:edit"])
          expect(scope.toolScopes).toHaveLength(1)
          expect(scope.toolScopes[0]?.toolName).toBe("edit")
          expect(scope.toolScopes[0]?.fileGlobs).toBeUndefined()
        })
      })
    })

    describe("#when tool:name(glob) token", () => {
      describe("#then", () => {
        it("adds named tool scope with file glob", () => {
          const scope = parseScope(["tool:edit(*.ts)"])
          expect(scope.toolScopes).toHaveLength(1)
          expect(scope.toolScopes[0]?.toolName).toBe("edit")
          expect(scope.toolScopes[0]?.fileGlobs).toContain("*.ts")
        })
      })
    })

    describe("#when glob shortcut token", () => {
      describe("#then", () => {
        it("expands to edit, write, multiedit tool scopes", () => {
          const scope = parseScope(["*.rs"])
          expect(scope.toolScopes).toHaveLength(3)
          const toolNames = scope.toolScopes.map((entry) => entry.toolName)
          expect(toolNames).toContain("edit")
          expect(toolNames).toContain("write")
          expect(toolNames).toContain("multiedit")
          for (const toolScope of scope.toolScopes) {
            expect(toolScope.fileGlobs).toContain("*.rs")
          }
        })
      })
    })

    describe("#when multiple tokens", () => {
      describe("#then", () => {
        it("combines text and thinking", () => {
          const scope = parseScope(["text", "thinking"])
          expect(scope.allowText).toBe(true)
          expect(scope.allowThinking).toBe(true)
        })
      })
    })
  })

  describe("#given matchesScope", () => {
    describe("#when text source", () => {
      describe("#then", () => {
        it("matches when allowText is true", () => {
          const scope = parseScope(["text"])
          expect(matchesScope(scope, { source: "text" })).toBe(true)
        })

        it("does not match when allowText is false", () => {
          const scope = parseScope(["tool"])
          expect(matchesScope(scope, { source: "text" })).toBe(false)
        })
      })
    })

    describe("#when tool source with allow any tool", () => {
      describe("#then", () => {
        it("always matches regardless of tool name", () => {
          const scope = parseScope(["tool"])
          expect(matchesScope(scope, { source: "tool", toolName: "edit" })).toBe(true)
        })
      })
    })

    describe("#when tool source with specific tool name", () => {
      describe("#then", () => {
        it("matches when tool name matches scope", () => {
          const scope = parseScope(["tool:edit"])
          expect(matchesScope(scope, { source: "tool", toolName: "edit" })).toBe(true)
        })

        it("does not match when tool name differs", () => {
          const scope = parseScope(["tool:edit"])
          expect(matchesScope(scope, { source: "tool", toolName: "write" })).toBe(false)
        })
      })
    })

    describe("#when tool source with file glob", () => {
      describe("#then", () => {
        it("matches when file path matches glob", () => {
          const scope = parseScope(["tool:edit(*.ts)"])
          expect(
            matchesScope(scope, {
              source: "tool",
              toolName: "edit",
              filePaths: ["src/foo.ts"],
            })
          ).toBe(true)
        })

        it("does not match when file path does not match glob", () => {
          const scope = parseScope(["tool:edit(*.ts)"])
          expect(
            matchesScope(scope, {
              source: "tool",
              toolName: "edit",
              filePaths: ["src/foo.rs"],
            })
          ).toBe(false)
        })
      })
    })
  })
})
