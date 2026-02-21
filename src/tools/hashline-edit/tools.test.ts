import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createHashlineEditTool } from "./tools"
import { computeLineHash } from "./hash-computation"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

function createMockContext(): ToolContext {
  return {
    sessionID: "test",
    messageID: "test",
    agent: "test",
    abort: new AbortController().signal,
    metadata: mock(() => {}),
    ask: async () => {},
  } as unknown as ToolContext
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
  })

  it("applies set_line with LINE#ID anchor", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3")
    const hash = computeLineHash(2, "line2")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [{ type: "set_line", line: `2#${hash}`, text: "modified line2" }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\nmodified line2\nline3")
    expect(result).toContain("Successfully")
    expect(result).toContain("Updated file (LINE#ID:content)")
    expect(result).toMatch(/2#[ZPMQVRWSNKTXJBYH]{2}:modified line2/)
  })

  it("applies replace_lines and insert_after", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3\nline4")
    const line2Hash = computeLineHash(2, "line2")
    const line3Hash = computeLineHash(3, "line3")
    const line4Hash = computeLineHash(4, "line4")

    //#when
    await tool.execute(
      {
        filePath,
        edits: [
          {
            type: "replace_lines",
            start_line: `2#${line2Hash}`,
            end_line: `3#${line3Hash}`,
            text: "replaced",
          },
          {
            type: "insert_after",
            line: `4#${line4Hash}`,
            text: "inserted",
          },
        ],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\nreplaced\nline4\ninserted")
  })

  it("returns mismatch error on stale anchor", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [{ type: "set_line", line: "1#ZZ", text: "new" }],
      },
      createMockContext(),
    )

    //#then
    expect(result).toContain("Error")
    expect(result).toContain(">>>")
  })

  it("preserves literal backslash-n and supports string[] payload", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2")
    const line1Hash = computeLineHash(1, "line1")

    //#when
    await tool.execute(
      {
        filePath,
        edits: [{ type: "set_line", line: `1#${line1Hash}`, text: "join(\\n)" }],
      },
      createMockContext(),
    )

    await tool.execute(
      {
        filePath,
        edits: [{ type: "insert_after", line: `1#${computeLineHash(1, "join(\\n)")}`, text: ["a", "b"] }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("join(\\n)\na\nb\nline2")
  })

  it("supports insert_before and insert_between", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3")
    const line1 = computeLineHash(1, "line1")
    const line2 = computeLineHash(2, "line2")
    const line3 = computeLineHash(3, "line3")

    //#when
    await tool.execute(
      {
        filePath,
        edits: [
          { type: "insert_before", line: `3#${line3}`, text: ["before3"] },
          { type: "insert_between", after_line: `1#${line1}`, before_line: `2#${line2}`, text: ["between"] },
        ],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\nbetween\nline2\nbefore3\nline3")
  })

  it("returns error when insert text is empty array", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2")
    const line1 = computeLineHash(1, "line1")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [{ type: "insert_after", line: `1#${line1}`, text: [] }],
      },
      createMockContext(),
    )

    //#then
    expect(result).toContain("Error")
    expect(result).toContain("non-empty")
  })

  it("supports file rename with edits", async () => {
    //#given
    const filePath = path.join(tempDir, "source.txt")
    const renamedPath = path.join(tempDir, "renamed.txt")
    fs.writeFileSync(filePath, "line1\nline2")
    const line2 = computeLineHash(2, "line2")

    //#when
    await tool.execute(
      {
        filePath,
        rename: renamedPath,
        edits: [{ type: "set_line", line: `2#${line2}`, text: "line2-updated" }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.readFileSync(renamedPath, "utf-8")).toBe("line1\nline2-updated")
  })

  it("supports file delete mode", async () => {
    //#given
    const filePath = path.join(tempDir, "delete-me.txt")
    fs.writeFileSync(filePath, "line1")

    //#when
    const result = await tool.execute(
      {
        filePath,
        delete: true,
        edits: [],
      },
      createMockContext(),
    )

    //#then
    expect(fs.existsSync(filePath)).toBe(false)
    expect(result).toContain("Successfully deleted")
  })
})
