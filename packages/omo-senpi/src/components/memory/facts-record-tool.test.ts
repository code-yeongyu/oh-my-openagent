import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFactsRecordTool } from "./facts-record-tool"

describe("facts record tool", () => {
  test("#given a one-record budget #when calls race #then the count is reserved before append", async () => {
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "")
      const failures: string[] = []
      const tool = createFactsRecordTool({ extractionPath: path, maxRecords: 1, onFailure: (reason) => failures.push(reason) })
      const record = { scope: "project" as const, text: "fact", date: "2026-08-10" }
      const results = await Promise.all([tool.execute("one", record), tool.execute("two", record)])
      expect(results.filter((result) => result.isError === true)).toHaveLength(1)
      expect(failures).toHaveLength(1)
      expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("#given an exact JSONL byte budget #when two calls race #then only one reserves space and any rejection invalidates the run", async () => {
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "")
      const record = { scope: "project" as const, text: "é🌍", date: "2026-08-10" }
      const line = `${JSON.stringify(record)}\n`
      const failures: string[] = []
      const tool = createFactsRecordTool({ extractionPath: path, maxBytes: Buffer.byteLength(line), onFailure: (reason) => failures.push(reason) })
      const results = await Promise.all([tool.execute("one", record), tool.execute("two", record)])
      expect(results.filter((result) => result.isError === true)).toHaveLength(1)
      expect(failures).toHaveLength(1)
      expect(await readFile(path, "utf8")).toBe(line)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("#given a bounded extraction append error #when recording fails #then the owner is notified instead of treating a prefix as success", async () => {
    const failures: string[] = []
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const tool = createFactsRecordTool({ extractionPath: root, onFailure: (reason) => failures.push(reason) })
      expect((await tool.execute("one", { scope: "project", text: "fact", date: "2026-08-10" })).isError).toBe(true)
      expect(failures).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("#given the registered record_fact schema #when inspected #then it is a top-level object for provider tool contracts", () => {
    // given
    const tool = createFactsRecordTool({ extractionPath: "/tmp/facts-record-tool-test.jsonl" })

    // when / then
    expect(tool.parameters.type).toBe("object")
    expect("anyOf" in tool.parameters).toBe(false)
  })

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
