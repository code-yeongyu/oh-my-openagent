import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { proposalId, type FactsPayload } from "@oh-my-opencode/memory-core"

import { createFactsRecordTool, payloadExchanges } from "./facts-record-tool"

describe("facts record tool", () => {
  test("#given a one-record budget #when calls race #then the count is reserved before append", async () => {
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "")
      const failures: string[] = []
      const tool = createFactsRecordTool({ exchanges: [], extractionPath: path, maxRecords: 1, onFailure: (reason) => failures.push(reason) })
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
      const line = `${JSON.stringify({ ...record, receipt: { source: "inferred" } })}\n`
      const failures: string[] = []
      const tool = createFactsRecordTool({ exchanges: [], extractionPath: path, maxBytes: Buffer.byteLength(line), onFailure: (reason) => failures.push(reason) })
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
      const tool = createFactsRecordTool({ exchanges: [], extractionPath: root, onFailure: (reason) => failures.push(reason) })
      expect((await tool.execute("one", { scope: "project", text: "fact", date: "2026-08-10" })).isError).toBe(true)
      expect(failures).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test("#given the registered record_fact schema #when inspected #then it is a top-level object for provider tool contracts", () => {
    // given
    const tool = createFactsRecordTool({ exchanges: [], extractionPath: "/tmp/facts-record-tool-test.jsonl" })

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
      const tool = createFactsRecordTool({ exchanges: [], extractionPath: path })

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
      const tool = createFactsRecordTool({ exchanges: [], extractionPath: path })

      // when
      await tool.execute("person", { scope: "person", person: { name: "Mina", aliases: ["Min"] }, text: "Mina prefers Bun.", date: "2026-08-10" })
      await tool.execute("project", { scope: "project", text: "The project uses Bun.", date: "2026-08-10" })

      // then
      expect(await readFile(path, "utf8")).toBe(
        '{"scope":"person","person":{"name":"Mina","aliases":["Min"]},"text":"Mina prefers Bun.","date":"2026-08-10","receipt":{"source":"inferred"}}\n'
        + '{"scope":"project","text":"The project uses Bun.","date":"2026-08-10","receipt":{"source":"inferred"}}\n',
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
      const tool = createFactsRecordTool({ exchanges: [], extractionPath: path })
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

  test("#given the #10488 flip: a 'user decided' fact quoting the agent's suggestion #when recorded #then it is stored as an agent suggestion", async () => {
    const root = await mkdtemp(join(tmpdir(), "facts-record-tool-"))
    try {
      const path = join(root, "extraction.jsonl")
      await Bun.write(path, "")
      const tool = createFactsRecordTool({ exchanges: [{ proposal: "I suggest removing plugins X and Y.", reply: "yes delete it" }, { proposal: "Anything else?", reply: "Review the plugins and tell me which look unused." }], extractionPath: path })

      await tool.execute("flip", { scope: "project", text: "User agreed to remove plugins X and Y.", date: "2026-10-18", source: "user", user_quote: "remove plugins X and Y" })
      await tool.execute("real", { scope: "project", text: "User wants an unused-plugin review.", date: "2026-10-18", source: "user", user_quote: "yes delete it" })
      await tool.execute("whole-not-consent", { scope: "project", text: "User wants an unused-plugin review.", date: "2026-10-18", source: "user", user_quote: "Review the plugins and tell me which look unused." })
      await tool.execute("partial", { scope: "project", text: "User asked which plugins look unused.", date: "2026-10-18", source: "user", user_quote: "tell me which look unused" })

      const [flip, real, wholeNotConsent, partial] = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
      expect(wholeNotConsent.receipt).toEqual({ source: "agent", downgraded: true })
      expect(flip.receipt).toEqual({ source: "agent", downgraded: true })
      expect(partial.receipt).toEqual({ source: "agent", downgraded: true })
      expect(real.receipt).toEqual({ source: "user", userQuote: "yes delete it", approves: proposalId("I suggest removing plugins X and Y.") })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("payload consent exchanges", () => {
  const line = (kind: "user" | "assistant" | "reasoning", text: string, id: string) => ({ kind, text, captured_at: "2026-10-19T00:00:00.000Z", source_line_id: id, source_message_id: id })
  const payload = (items: readonly ReturnType<typeof line>[]): FactsPayload => ({
    version: 1,
    identity: "i",
    today: "2026-10-19",
    knownPeople: [],
    primaryHuman: { slug: "human", aliases: [] },
    entries: [{
      version: 1, identity: "i", sessionId: "s", conversationId: "s", enqueuedAt: "2026-10-19T00:00:00.000Z",
      range: { start_message_id: "a", end_message_id: "z", start_line: 0, end_snapshot_line: 0 },
      entries: items,
    }],
  })

  test("#given a user reply right after an assistant proposal #when exchanges are read #then that pair is the only consent candidate", () => {
    expect(payloadExchanges(payload([
      line("user", "ok", "1"),
      line("assistant", "Shall I delete plugin X?", "2"),
      line("reasoning", "thinking", "3"),
      line("user", "yes delete it", "4"),
      line("user", "ok", "5"),
    ]))).toEqual([{ proposal: "Shall I delete plugin X?", reply: "yes delete it" }])
  })

  test("#given a queue entry that starts with the user's reply #when its lead is the assistant proposal #then the reply pairs with it", () => {
    const withLead = (lead: ReturnType<typeof line> | undefined, items: readonly ReturnType<typeof line>[]): FactsPayload => {
      const base = payload(items)
      const [only] = base.entries
      if (only === undefined) throw new Error("no entry")
      return { ...base, entries: [lead === undefined ? only : { ...only, lead }] }
    }
    expect(payloadExchanges(withLead(line("assistant", "Shall I delete plugin X?", "0"), [line("user", "ok", "1")])))
      .toEqual([{ proposal: "Shall I delete plugin X?", reply: "ok" }])
    expect(payloadExchanges(withLead(line("user", "", "0"), [line("user", "ok", "1")]))).toEqual([])
    expect(payloadExchanges(withLead(undefined, [line("user", "ok", "1")]))).toEqual([])
    expect(payloadExchanges(payload([line("assistant", "Shall I?", "1"), line("user", "", "2"), line("user", "ok", "3")]))).toEqual([])
  })
})
