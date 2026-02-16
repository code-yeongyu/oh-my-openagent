import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHashlineEditTool } from "./tools"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { computeLineHash } from "./hash-computation"

describe("createHashlineEditTool", () => {
  let tempDir: string
  let tool: ReturnType<typeof createHashlineEditTool>

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hashline-edit-test-"))
    tool = createHashlineEditTool()
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
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

    it("has path parameter", () => {
      //#given tool is created
      //#when checking parameters
      //#then path parameter exists as required string
      expect(tool.args.path).toBeDefined()
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
          path: nonExistentPath,
          edits: [{ type: "set_line", line: "1:00", text: "new content" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [{ type: "set_line", line: `2:${line2Hash}`, text: "modified line2" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [{ type: "insert_after", line: `1:${line1Hash}`, text: "inserted" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [
            {
              type: "replace_lines",
              start_line: `2:${line2Hash}`,
              end_line: `3:${line3Hash}`,
              text: "replaced",
            },
          ],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [{ type: "replace", old_text: "world", new_text: "universe" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [
            { type: "set_line", line: `1:${line1Hash}`, text: "new1" },
            { type: "set_line", line: `3:${line3Hash}`, text: "new3" },
          ],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [{ type: "set_line", line: "1:ff", text: "new" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [{ type: "set_line", line: `1:${line1Hash}`, text: "new\\nline" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
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
          path: filePath,
          edits: [{ type: "set_line", line: `1:${line1Hash}`, text: "new content" }],
        },
        { sessionID: "test", messageID: "test", agent: "test", abort: new AbortController() }
      )

      //#then result contains success indicator and diff
      expect(result).toContain("Successfully")
      expect(result).toContain("old content")
      expect(result).toContain("new content")
    })
  })
})
