import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { consumeToolMetadata, clearPendingStore } from "../../features/tool-metadata-store"
import { createHashlineEditTool } from "./tools"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { computeLineHash } from "./hash-computation"

type MetadataPayload = {
  title?: string
  metadata?: Record<string, unknown>
}

function createMockContext(overrides?: Partial<Pick<ToolContext, "metadata">>): ToolContext {
  return {
    sessionID: "test",
    messageID: "test",
    agent: "test",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: overrides?.metadata ?? mock(() => {}),
    ask: async () => {},
  }
}

type ToolContextWithCallID = ToolContext & {
  callID?: string
  callId?: string
  call_id?: string
}

describe("createHashlineEditTool", () => {
  let tempDir: string
  let tool: ReturnType<typeof createHashlineEditTool>

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hashline-edit-test-"))
    tool = createHashlineEditTool()
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    clearPendingStore()
  })

  describe("tool definition", () => {
    it("has correct description", () => {
      //#given tool is created
      //#when accessing tool properties
      //#then description explains LINE:HASH format
      expect(tool.description).toContain("LINE:HASH")
      expect(tool.description).toContain("set_line")
      expect(tool.description).toContain("replace_lines")
      expect(tool.description).toContain("insert_after")
      expect(tool.description).toContain("replace")
    })

    it("has filePath parameter", () => {
      //#given tool is created
      //#when checking parameters
      //#then filePath exists
      expect(tool.args.filePath).toBeDefined()
    })

    it("has edits parameter as array", () => {
      //#given tool is created
      //#when checking parameters
      //#then edits parameter exists as array
      expect(tool.args.edits).toBeDefined()
    })
  })

  describe("execute", () => {
    it("returns error when file does not exist", async () => {
      //#given non-existent file path
      const nonExistentPath = path.join(tempDir, "non-existent.txt")

      //#when executing tool
      const result = await tool.execute(
        {
          filePath: nonExistentPath,
          edits: [{ type: "set_line", line: "1:00", text: "new content" }],
        },
        createMockContext()
      )

      //#then error is returned
      expect(result).toContain("Error")
      expect(result).toContain("not found")
    })

    it("applies set_line edit and returns diff", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2\nline3")
      const line2Hash = computeLineHash(2, "line2")

      //#when executing set_line edit
      const result = await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: `2:${line2Hash}`, text: "modified line2" }],
        },
        createMockContext()
      )

      //#then file is modified and diff is returned
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toBe("line1\nmodified line2\nline3")
      expect(result).toContain("modified line2")
    })

    it("applies insert_after edit", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2")
      const line1Hash = computeLineHash(1, "line1")

      //#when executing insert_after edit
      const result = await tool.execute(
        {
          filePath,
          edits: [{ type: "insert_after", line: `1:${line1Hash}`, text: "inserted" }],
        },
        createMockContext()
      )

      //#then line is inserted after specified line
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toBe("line1\ninserted\nline2")
    })

    it("applies replace_lines edit", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4")
      const line2Hash = computeLineHash(2, "line2")
      const line3Hash = computeLineHash(3, "line3")

      //#when executing replace_lines edit
      const result = await tool.execute(
        {
          filePath,
          edits: [
            {
              type: "replace_lines",
              start_line: `2:${line2Hash}`,
              end_line: `3:${line3Hash}`,
              text: "replaced",
            },
          ],
        },
        createMockContext()
      )

      //#then lines are replaced
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toBe("line1\nreplaced\nline4")
    })

    it("applies replace edit", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "hello world\nfoo bar")

      //#when executing replace edit
      const result = await tool.execute(
        {
          filePath,
          edits: [{ type: "replace", old_text: "world", new_text: "universe" }],
        },
        createMockContext()
      )

      //#then text is replaced
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toBe("hello universe\nfoo bar")
    })

    it("applies multiple edits in bottom-up order", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2\nline3")
      const line1Hash = computeLineHash(1, "line1")
      const line3Hash = computeLineHash(3, "line3")

      //#when executing multiple edits
      const result = await tool.execute(
        {
          filePath,
          edits: [
            { type: "set_line", line: `1:${line1Hash}`, text: "new1" },
            { type: "set_line", line: `3:${line3Hash}`, text: "new3" },
          ],
        },
        createMockContext()
      )

      //#then both edits are applied
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toBe("new1\nline2\nnew3")
    })

    it("returns error on hash mismatch", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2")

      //#when executing with wrong hash (valid format but wrong value)
      const result = await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: "1:ff", text: "new" }],
        },
        createMockContext()
      )

      //#then hash mismatch error is returned
      expect(result).toContain("Error")
      expect(result).toContain("hash")
    })

    it("handles escaped newlines in text", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2")
      const line1Hash = computeLineHash(1, "line1")

      //#when executing with escaped newline
      const result = await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: `1:${line1Hash}`, text: "new\\nline" }],
        },
        createMockContext()
      )

      //#then newline is unescaped
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toBe("new\nline\nline2")
    })

    it("returns success result with diff summary", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "old content")
      const line1Hash = computeLineHash(1, "old content")

      //#when executing edit
      const result = await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: `1:${line1Hash}`, text: "new content" }],
        },
        createMockContext()
      )

      //#then result contains success indicator and diff
      expect(result).toContain("Successfully")
      expect(result).toContain("old content")
      expect(result).toContain("new content")
      expect(result).toContain("Updated file (LINE:HASH|content)")
      expect(result).toMatch(/1:[a-f0-9]{2}\|new content/)
    })
  })

  describe("context.metadata for TUI diff", () => {
    it("calls context.metadata with diff and filediff on successful edit", async () => {
      //#given file with content and mock context
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2\nline3")
      const line2Hash = computeLineHash(2, "line2")
      const metadataMock = mock((_: MetadataPayload) => {})
      const ctx = createMockContext({ metadata: metadataMock })

      //#when executing a successful edit
      await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: `2:${line2Hash}`, text: "modified" }],
        },
        ctx
      )

      //#then context.metadata is called with diff string and filediff object
      expect(metadataMock).toHaveBeenCalledTimes(1)
      const call = metadataMock.mock.calls[0]?.[0]
      expect(call).toBeDefined()
      if (!call || !call.metadata) {
        throw new Error("metadata payload missing")
      }
      expect(call.title).toBe(filePath)
      expect(call.metadata.filePath).toBe(filePath)
      expect(call.metadata.path).toBe(filePath)
      expect(call.metadata.file).toBe(filePath)
      expect(call.metadata.diff).toContain("---")
      expect(call.metadata.diff).toContain("+++")
      expect(call.metadata.diff).toContain("-line2")
      expect(call.metadata.diff).toContain("+modified")
      expect(call.metadata.filediff.file).toBe(filePath)
      expect(call.metadata.filediff.path).toBe(filePath)
      expect(call.metadata.filediff.filePath).toBe(filePath)
      expect(typeof call.metadata.filediff.before).toBe("string")
      expect(typeof call.metadata.filediff.after).toBe("string")
      expect(typeof call.metadata.filediff.additions).toBe("number")
      expect(typeof call.metadata.filediff.deletions).toBe("number")
    })

    it("includes hashline content in filediff before/after", async () => {
      //#given file with known content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "hello\nworld")
      const line1Hash = computeLineHash(1, "hello")
      const metadataMock = mock((_: MetadataPayload) => {})
      const ctx = createMockContext({ metadata: metadataMock })

      //#when executing edit
      await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: `1:${line1Hash}`, text: "hi" }],
        },
        ctx
      )

      //#then filediff.before contains hashline format of original content
      const call = metadataMock.mock.calls[0]?.[0]
      expect(call).toBeDefined()
      if (!call || !call.metadata) {
        throw new Error("metadata payload missing")
      }
      expect(call.metadata.filediff.before).toContain("1:")
      expect(call.metadata.filediff.before).toContain("|hello")
      expect(call.metadata.filediff.after).toContain("1:")
      expect(call.metadata.filediff.after).toContain("|hi")
    })

    it("reports correct additions and deletions count", async () => {
      //#given file with content
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "aaa\nbbb\nccc")
      const metadataMock = mock((_: MetadataPayload) => {})
      const ctx = createMockContext({ metadata: metadataMock })

      //#when replacing text that changes one line
      await tool.execute(
        {
          filePath,
          edits: [{ type: "replace", old_text: "bbb", new_text: "xxx" }],
        },
        ctx
      )

      //#then additions and deletions are both 1
      const call = metadataMock.mock.calls[0]?.[0]
      expect(call).toBeDefined()
      if (!call || !call.metadata) {
        throw new Error("metadata payload missing")
      }
      expect(call.metadata.filediff.additions).toBe(1)
      expect(call.metadata.filediff.deletions).toBe(1)
    })

    it("does not call context.metadata on error", async () => {
      //#given non-existent file
      const nonExistentPath = path.join(tempDir, "nope.txt")
      const metadataMock = mock(() => {})
      const ctx = createMockContext({ metadata: metadataMock })

      //#when executing tool on missing file
      await tool.execute(
        {
          filePath: nonExistentPath,
          edits: [{ type: "set_line", line: "1:00", text: "new" }],
        },
        ctx
      )

      //#then context.metadata is never called
      expect(metadataMock).not.toHaveBeenCalled()
    })

    it("stores metadata for tool.execute.after restoration when callID exists", async () => {
      //#given file and context with callID
      const filePath = path.join(tempDir, "test.txt")
      fs.writeFileSync(filePath, "line1\nline2")
      const line2Hash = computeLineHash(2, "line2")

      const metadataMock = mock((_: MetadataPayload) => {})
      const ctx: ToolContextWithCallID = {
        ...createMockContext({ metadata: metadataMock }),
        callID: "call-edit-meta-1",
      }

      //#when executing edit
      await tool.execute(
        {
          filePath,
          edits: [{ type: "set_line", line: `2:${line2Hash}`, text: "modified" }],
        },
        ctx,
      )

      //#then pending metadata store has restorable metadata
      const restored = consumeToolMetadata(ctx.sessionID, "call-edit-meta-1")
      expect(restored).toBeDefined()
      expect(restored?.title).toBe(filePath)
      expect(typeof restored?.metadata?.diff).toBe("string")
      expect(restored?.metadata?.filediff).toBeDefined()
    })
  })
})
