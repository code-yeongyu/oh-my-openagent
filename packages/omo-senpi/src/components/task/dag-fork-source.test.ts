import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseDagSessionStartEvent, readDagSessionHeader, resolveDagForkSource } from "./dag-fork-source"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function sessionFile(name: string, header: Record<string, unknown>, trailing = "\n"): string {
  const root = fs.mkdtempSync(join(tmpdir(), "dag-fork-source-"))
  roots.push(root)
  const path = join(root, name)
  fs.writeFileSync(path, JSON.stringify(header) + trailing)
  return path
}

describe("parseDagSessionStartEvent", () => {
  test.each([
    { label: "undefined", payload: undefined },
    { label: "null", payload: null },
    { label: "a string", payload: "fork" },
    { label: "a number", payload: 7 },
    { label: "an array", payload: [] },
    { label: "an empty object", payload: {} },
    { label: "a blank reason", payload: { reason: " " } },
    { label: "a numeric reason", payload: { reason: 3 } },
  ])("#given payload $label #when parsed #then it is rejected", ({ payload }) => {
    expect(parseDagSessionStartEvent(payload)).toBeUndefined()
  })

  test("#given a fork payload with a blank previousSessionFile #when parsed #then the file is treated as absent", () => {
    expect(parseDagSessionStartEvent({ reason: "fork", previousSessionFile: "  " })).toEqual({ reason: "fork", previousSessionFile: undefined })
  })
})

describe("readDagSessionHeader", () => {
  test("#given a header line without a trailing newline #when read #then the identity and parent are returned", async () => {
    const path = sessionFile("s.jsonl", { type: "session", id: "A", parentSession: "/p/a.jsonl" }, "")
    expect(await readDagSessionHeader(path)).toEqual({ id: "A", parentSession: "/p/a.jsonl" })
  })

  test("#given a header larger than the read limit #when read #then it is rejected without reading the rest", async () => {
    const path = sessionFile("s.jsonl", { type: "session", id: "A", padding: "x".repeat(70 * 1024) })
    await expect(readDagSessionHeader(path)).rejects.toThrow("read limit")
  })

  test("#given a blank parentSession #when read #then no parent is declared", async () => {
    const path = sessionFile("s.jsonl", { type: "session", id: "A", parentSession: " " })
    expect((await readDagSessionHeader(path)).parentSession).toBeUndefined()
  })
})

describe("resolveDagForkSource", () => {
  test("#given a non-fork reason #when resolved #then own-only without a diagnostic", async () => {
    const current = sessionFile("c.jsonl", { type: "session", id: "C", parentSession: "/nowhere.jsonl" })
    const resolution = await resolveDagForkSource({ event: { reason: "resume", previousSessionFile: current }, currentSessionId: "C", currentSessionFile: current })
    expect(resolution).toEqual({ kind: "own-only", diagnostic: undefined })
  })

  test("#given the declared parent is the forked session itself #when resolved #then own-only with a diagnostic", async () => {
    const parent = sessionFile("a.jsonl", { type: "session", id: "C" })
    const current = sessionFile("c.jsonl", { type: "session", id: "C", parentSession: parent })
    const resolution = await resolveDagForkSource({ event: { reason: "fork", previousSessionFile: parent }, currentSessionId: "C", currentSessionFile: current })
    expect(resolution.kind).toBe("own-only")
    expect(resolution.kind === "own-only" ? resolution.diagnostic : undefined).toContain("own identity")
  })

  test("#given a parent path spelled through a relative segment #when it resolves to the declared parent #then the source is accepted", async () => {
    const parent = sessionFile("a.jsonl", { type: "session", id: "A" })
    const current = sessionFile("c.jsonl", { type: "session", id: "C", parentSession: parent })
    const offered = join(parent, "..", "a.jsonl")
    const resolution = await resolveDagForkSource({ event: { reason: "fork", previousSessionFile: offered }, currentSessionId: "C", currentSessionFile: current })
    expect(resolution).toEqual({ kind: "source", sessionId: "A" })
  })
})
