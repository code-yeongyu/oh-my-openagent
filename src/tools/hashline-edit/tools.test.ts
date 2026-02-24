import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createHashlineEditTool } from "./tools"
import { computeLineHash } from "./hash-computation"
import { canonicalizeFileText } from "./file-text-canonicalization"
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

  it("applies replace with single LINE#ID anchor", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3")
    const hash = computeLineHash(2, "line2")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [{ op: "replace", pos: `2#${hash}`, lines: "modified line2" }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\nmodified line2\nline3")
    expect(result).toBe(`Updated ${filePath}`)
  })

  it("applies ranged replace and anchored append", async () => {
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
            op: "replace",
            pos: `2#${line2Hash}`,
            end: `3#${line3Hash}`,
            lines: "replaced",
          },
          {
            op: "append",
            pos: `4#${line4Hash}`,
            lines: "inserted",
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
        edits: [{ op: "replace", pos: "1#ZZ", lines: "new" }],
      },
      createMockContext(),
    )

    //#then
    expect(result).toContain("Error")
    expect(result).toContain(">>>")
  })

  it("does not classify invalid pos format as hash mismatch", async () => {
    //#given
    const filePath = path.join(tempDir, "invalid-format.txt")
    fs.writeFileSync(filePath, "line1\nline2")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [{ op: "replace", pos: "42", lines: "updated" }],
      },
      createMockContext(),
    )

    //#then
    expect(result).toContain("Error")
    expect(result.toLowerCase()).not.toContain("hash mismatch")
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
        edits: [{ op: "replace", pos: `1#${line1Hash}`, lines: "join(\\n)" }],
      },
      createMockContext(),
    )

    await tool.execute(
      {
        filePath,
        edits: [{ op: "append", pos: `1#${computeLineHash(1, "join(\\n)")}`, lines: ["a", "b"] }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("join(\\n)\na\nb\nline2")
  })

  it("supports anchored prepend and anchored append", async () => {
    //#given
    const filePath = path.join(tempDir, "test.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3")
    const line1 = computeLineHash(1, "line1")
    const line3 = computeLineHash(3, "line3")

    //#when
    await tool.execute(
      {
        filePath,
        edits: [
          { op: "prepend", pos: `3#${line3}`, lines: ["before3"] },
          { op: "append", pos: `1#${line1}`, lines: ["between"] },
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
        edits: [{ op: "append", pos: `1#${line1}`, lines: [] }],
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
    const result = await tool.execute(
      {
        filePath,
        rename: renamedPath,
        edits: [{ op: "replace", pos: `2#${line2}`, lines: "line2-updated" }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.readFileSync(renamedPath, "utf-8")).toBe("line1\nline2-updated")
    expect(result).toBe(`Moved ${filePath} to ${renamedPath}`)
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

  it("creates missing file with append and prepend", async () => {
    //#given
    const filePath = path.join(tempDir, "created.txt")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [
          { op: "append", lines: ["line2"] },
          { op: "prepend", lines: ["line1"] },
        ],
      },
      createMockContext(),
    )

    //#then
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\nline2")
    expect(result).toBe(`Updated ${filePath}`)
  })

  it("accepts replace with one anchor", async () => {
    //#given
    const filePath = path.join(tempDir, "degrade.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3")
    const line2Hash = computeLineHash(2, "line2")

    //#when
    const result = await tool.execute(
      {
        filePath,
        edits: [{ op: "replace", pos: `2#${line2Hash}`, lines: ["line2-updated"] }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\nline2-updated\nline3")
    expect(result).toBe(`Updated ${filePath}`)
  })

  it("accepts anchored append using end alias", async () => {
    //#given
    const filePath = path.join(tempDir, "alias.txt")
    fs.writeFileSync(filePath, "line1\nline2")
    const line1Hash = computeLineHash(1, "line1")

    //#when
    await tool.execute(
      {
        filePath,
        edits: [{ op: "append", end: `1#${line1Hash}`, lines: ["inserted"] }],
      },
      createMockContext(),
    )

    //#then
    expect(fs.readFileSync(filePath, "utf-8")).toBe("line1\ninserted\nline2")
  })

  it("preserves BOM and CRLF through hashline_edit", async () => {
    //#given
    const filePath = path.join(tempDir, "crlf-bom.txt")
    const bomCrLf = "\uFEFFline1\r\nline2\r\n"
    fs.writeFileSync(filePath, bomCrLf)
    const line2Hash = computeLineHash(2, "line2")

    //#when
    await tool.execute(
      {
        filePath,
        edits: [{ op: "replace", pos: `2#${line2Hash}`, lines: "line2-updated" }],
      },
      createMockContext(),
    )

    //#then
    const bytes = fs.readFileSync(filePath)
    expect(bytes[0]).toBe(0xef)
    expect(bytes[1]).toBe(0xbb)
    expect(bytes[2]).toBe(0xbf)
    expect(bytes.toString("utf-8")).toBe("\uFEFFline1\r\nline2-updated\r\n")
  })

  it("detects LF as line ending when LF appears before CRLF", () => {
    //#given
    const content = "line1\nline2\r\nline3"

    //#when
    const envelope = canonicalizeFileText(content)

    //#then
    expect(envelope.lineEnding).toBe("\n")
  })

  it("detects CRLF as line ending when CRLF appears before LF", () => {
    //#given
    const content = "line1\r\nline2\nline3"

    //#when
    const envelope = canonicalizeFileText(content)

    //#then
    expect(envelope.lineEnding).toBe("\r\n")
  })
})
