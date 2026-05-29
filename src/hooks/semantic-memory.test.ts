import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createSemanticMemoryHook } from "./semantic-memory"
import { contextCollector } from "../features/context-injector"
import { storeMemory, clearAllMemories, getRecentMemories } from "../features/semantic-memory"

const TEST_DIR = join(tmpdir(), "semantic-memory-hook-test-" + Date.now())

describe("Semantic Memory Hook", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    contextCollector.clearAll()
    clearAllMemories()
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
    clearAllMemories()
  })

  describe("#given modified files and matching memories", () => {
    it("should retrieve code memories on turn start (chat.message) and register with contextCollector", async () => {
      // given
      const testFile = join(TEST_DIR, "index.ts")
      writeFileSync(testFile, "console.log('hello')")

      mock.module("../shared/bun-spawn-shim", () => ({
        spawnSync: () => ({
          success: true,
          stdout: `M index.ts`,
        }),
      }))

      mock.module("@oh-my-opencode/ast-grep-mcp", () => ({
        runSg: async () => ({
          matches: [
            {
              text: "console.log('hello')",
              range: { start: { line: 0 }, end: { line: 0 } }
            }
          ]
        })
      }))

      // Seed a real code memory directly in SQLite
      storeMemory("Avoid using raw print statements", {
        sessionId: "session-abc",
        memoryType: "context",
        filePath: testFile,
        symbolName: "hello",
        astPattern: "console.log($MSG)",
        afterContent: "log('hello')",
      })

      const hook = createSemanticMemoryHook({ directory: TEST_DIR }, {
        semantic_memory: {
          enabled: true,
          use_aft_precision: true,
        },
      })

      // when
      await hook["chat.message"]({ sessionID: "session-abc" })

      // then
      expect(contextCollector.hasPending("session-abc")).toBe(true)
      const pending = contextCollector.getPending("session-abc")
      expect(pending.merged).toContain("=== RELEVANT SEMANTIC MEMORIES OF PREVIOUS CODE PATTERNS ===")
      expect(pending.merged).toContain("Avoid using raw print statements")
      expect(pending.merged).toContain("console.log($MSG)")
    })
  })

  describe("#given tool execution transitions", () => {
    it("should capture file state in before and record memory in after if file content changed", async () => {
      // given
      const testFile = join(TEST_DIR, "index.ts")
      writeFileSync(testFile, "const a = 1;")

      mock.module("../shared/bun-spawn-shim", () => ({
        spawnSync: () => ({
          success: true,
          stdout: `M index.ts`,
        }),
      }))

      // Mock ast-grep runSg so it extracts a mock symbol name
      mock.module("@oh-my-opencode/ast-grep-mcp", () => ({
        runSg: async () => ({
          matches: [
            {
              text: "const a = 2;",
              range: { start: { line: 0 }, end: { line: 0 } },
            },
          ],
        }),
      }))

      const hook = createSemanticMemoryHook({ directory: TEST_DIR }, {
        semantic_memory: {
          enabled: true,
        },
      })

      const callID = "call-999"

      // when - pre-execution hook
      await hook["tool.execute.before"](
        { tool: "write_to_file", sessionID: "session-abc", callID },
        { args: { TargetFile: "index.ts" } }
      )

      // simulate the execution writing to the file
      writeFileSync(testFile, "const a = 2;")

      // when - post-execution hook
      await hook["tool.execute.after"](
        { tool: "write_to_file", sessionID: "session-abc", callID, args: { Instruction: "Update variable" } },
        { title: "Success", output: "Wrote 12 bytes", metadata: {} }
      )

      // then - verify the record was inserted into SQLite
      const memories = getRecentMemories(5)
      expect(memories.length).toBeGreaterThan(0)
      const latest = memories[0]
      expect(latest.content).toContain("Update variable")
      expect(latest.beforeContent).toBe("const a = 1;")
      expect(latest.afterContent).toBe("const a = 2;")
    })

    it("should store error memory in after if tool reports failure", async () => {
      // given
      const testFile = join(TEST_DIR, "index.ts")
      writeFileSync(testFile, "const a = 1;")

      const hook = createSemanticMemoryHook({ directory: TEST_DIR }, {
        semantic_memory: {
          enabled: true,
        },
      })

      const callID = "call-888"

      // when - pre-execution hook
      await hook["tool.execute.before"](
        { tool: "write_to_file", sessionID: "session-abc", callID },
        { args: { TargetFile: "index.ts" } }
      )

      // when - post-execution hook with failure
      await hook["tool.execute.after"](
        { tool: "write_to_file", sessionID: "session-abc", callID },
        { title: "Failure", output: "Error: Permission denied", metadata: {} }
      )

      // then - verify error memory in SQLite
      const memories = getRecentMemories(5)
      expect(memories.length).toBeGreaterThan(0)
      const errorMem = memories.find(m => m.memoryType === "error")
      expect(errorMem).toBeDefined()
      expect(errorMem!.content).toContain("Permission denied")
    })
  })
})
