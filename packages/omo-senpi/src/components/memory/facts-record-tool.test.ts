import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFactsRecordTool } from "./facts-record-tool"

describe("facts record tool", () => {
  test("#given malformed records #when the tool is called #then it returns errors and appends nothing", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "seed\n")
      const tool = createFactsRecordTool({ extractionPath: path })

      // when
      const malformed = JSON.parse('[{"scope":"project","text":"missing"},{"scope":"other","text":"bad","date":"2026-08-10"},{"scope":"person","person":"bad","text":"bad","date":"2026-08-10"}]')
      const results = await Promise.all([
        tool.execute("missing-date", malformed[0]),
        tool.execute("bad-scope", malformed[1]),
        tool.execute("bad-person", malformed[2]),
      ])

      // then
      expect(results.every((result) => result.isError === true)).toBe(true)
      expect(await readFile(path, "utf8")).toBe("seed\n")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("#given valid person and project records #when recorded in order #then exact JSONL lines are appended", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "")
      const tool = createFactsRecordTool({ extractionPath: path })

      // when
      await tool.execute("person", { scope: "person", person: { name: "Mina", aliases: ["Min"] }, text: "Mina prefers Bun.", date: "2026-08-10" })
      await tool.execute("project", { scope: "project", text: "The project uses Bun.", date: "2026-08-10" })

      // then
      expect(await readFile(path, "utf8")).toBe(
        '{"scope":"person","person":{"name":"Mina","aliases":["Min"]},"text":"Mina prefers Bun.","date":"2026-08-10"}\n'
        + '{"scope":"project","text":"The project uses Bun.","date":"2026-08-10"}\n',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("#given an inactive facts run #when a late call arrives #then it returns an error without appending", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "")
      const tool = createFactsRecordTool({ extractionPath: path })
      tool.deactivate()

      // when
      const result = await tool.execute("late", { scope: "project", text: "late", date: "2026-08-10" })

      // then
      expect(result.isError).toBe(true)
      expect(await readFile(path, "utf8")).toBe("")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
