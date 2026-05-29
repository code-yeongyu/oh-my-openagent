import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createMagicContextHook } from "./magic-context"
import { contextCollector } from "../features/context-injector"

const TEST_DIR = join(tmpdir(), "magic-context-hook-test-" + Date.now())

describe("Magic Context Hook", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    contextCollector.clearAll()
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("#given modified files", () => {
    it("should extract signatures on turn start (chat.message) and register with contextCollector", async () => {
      // given
      const testFile = join(TEST_DIR, "app.ts")
      writeFileSync(testFile, "class AppController { run() {} }")

      mock.module("../shared/bun-spawn-shim", () => ({
        spawnSync: () => ({
          success: true,
          stdout: `M app.ts`,
        }),
      }))

      mock.module("@oh-my-opencode/ast-grep-mcp", () => ({
        runSg: async () => ({
          matches: [
            {
              text: "class AppController { run() {} }",
              range: { start: { line: 0 }, end: { line: 0 } }
            }
          ]
        })
      }))

      const hook = createMagicContextHook({ directory: TEST_DIR }, {
        magic_context: {
          enabled: true,
          use_aft_extraction: true,
          max_context_tokens: 4096,
        },
      })

      // when
      await hook["chat.message"]({ sessionID: "test-session-123" })

      // then
      expect(contextCollector.hasPending("test-session-123")).toBe(true)
      const pending = contextCollector.getPending("test-session-123")
      expect(pending.merged).toContain("=== WORKSPACE SURGICAL CLASS & INTERFACE SIGNATURES ===")
      expect(pending.merged).toContain("class AppController")
    })
  })
})
