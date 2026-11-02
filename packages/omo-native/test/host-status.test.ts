import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HOST_STATUS_RAW_ENV, isHostStatusAll, runHostStatusAll, sessionActivityReader } from "../bin/lib/host-status.js"
import { readDiskSession } from "../../omo-senpi/src/components/thread/address-book"
import { readSessionFacts } from "../../omo-senpi/src/components/thread/session-facts"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-host-status-"))
  dirs.push(dir)
  return dir
}

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

function sessionFile(dir: string, lines: readonly Record<string, unknown>[]): string {
  const path = join(dir, "2026-09-30T00-00-00-000Z_dur-tui.jsonl")
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)
  return path
}

function tuiRow(path: string | null) {
  return { socket: "/agent/rpc-host-daemon/x/t-1.sock", endpoint_kind: "tui", reachable: true, alive: true, reason: null, owner: { pid: 42, cwd: "/work", session: path === null ? null : { id: "dur-tui", path, name: "my-tui" } } }
}

const HOST_ROW = { socket: "/agent/rpc.sock", endpoint_kind: "rpc_host", reachable: true, alive: true, reason: null, owner: null }

async function runWith(stdoutLine: string, exitCode = 0, readActivity = (path: string) => readSessionFacts(path)?.updated_at ?? null) {
  const stdout = capture()
  const stderr = capture()
  const calls: { args: readonly string[]; env: Record<string, string | undefined> }[] = []
  const code = await runHostStatusAll(["host", "status", "--all", "--json", "--include-workers"], {
    engine: { run: (args: string[], options: { env: Record<string, string | undefined> }) => { calls.push({ args, env: options.env }); return { exitCode, stdout: stdoutLine, stderr: "engine note\n" } } },
    env: { KEEP: "1" },
    stdout,
    stderr,
    readActivity,
  })
  return { code, stdout: stdout.text(), stderr: stderr.text(), calls }
}

describe("omo host status --all: last_activity_at on tui rows", () => {
  test("#given a tui row whose session file has entries #when status runs #then the row carries the newest entry timestamp, the value thread list shows as updated_at, and other rows are untouched", async () => {
    const path = sessionFile(scratch(), [
      { type: "session", id: "dur-tui", cwd: "/work", timestamp: "2026-09-30T01:00:00.000Z" },
      { type: "message", timestamp: "2026-09-30T01:05:00.000Z", message: { role: "user", content: "hi" } },
      { type: "message", timestamp: "2026-09-30T01:07:30.000Z", message: { role: "assistant", content: "hello" } },
    ])
    const result = await runWith(JSON.stringify({ endpoints: [HOST_ROW, tuiRow(path)] }))
    const printed = JSON.parse(result.stdout)
    expect(printed.endpoints[1].last_activity_at).toBe("2026-09-30T01:07:30.000Z")
    expect(printed.endpoints[1].last_activity_at).toBe(readSessionFacts(path)?.updated_at)
    expect(printed.endpoints[0]).toEqual(HOST_ROW)
    expect(result.stdout.endsWith("}\n")).toBe(true)
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "engine note\n" })
    expect(result.calls).toEqual([{ args: ["host", "status", "--all", "--json", "--include-workers"], env: { KEEP: "1", [HOST_STATUS_RAW_ENV]: "1" } }])
  })

  test("#given a tui row whose final session entry is larger than the facts window #when status runs #then last_activity_at is the final entry timestamp", async () => {
    const path = sessionFile(scratch(), [
      { type: "session", id: "dur-tui", cwd: "/work", timestamp: "2026-09-30T01:00:00.000Z" },
      { type: "message", timestamp: "2026-09-30T01:05:00.000Z", message: { role: "user", content: "hi" } },
      { type: "message", timestamp: "2026-09-30T02:00:00.000Z", message: { role: "assistant", content: "x".repeat(160 * 1024) } },
    ])

    const result = await runWith(JSON.stringify({ endpoints: [tuiRow(path)] }))

    expect(JSON.parse(result.stdout).endpoints[0].last_activity_at).toBe("2026-09-30T02:00:00.000Z")
  })

  test("#given a session whose final line is partial #when status and degraded listing read it #then both report unknown activity", async () => {
    const dir = scratch()
    const path = join(dir, "partial.jsonl")
    writeFileSync(path, `${[
      { type: "session", id: "dur-tui", cwd: "/work", timestamp: "2026-09-30T01:00:00.000Z" },
      { type: "message", timestamp: "2026-09-30T01:05:00.000Z", message: { role: "user", content: "hi" } },
    ].map((entry) => JSON.stringify(entry)).join("\n")}\n{"type":"message","timestamp":"2026-09-30T02:00:00.000Z"`)

    const status = await runWith(JSON.stringify({ endpoints: [tuiRow(path)] }))
    const disk = readDiskSession(path, "/agent/rpc-host-daemon/x/t-1.sock")

    expect({
      last_activity_at: JSON.parse(status.stdout).endpoints[0].last_activity_at,
      updated_at: disk?.updated_at,
    }).toEqual({ last_activity_at: null, updated_at: null })
  })

  test.each([
    ["the session file is missing", (dir: string) => tuiRow(join(dir, "gone.jsonl"))],
    ["the row names no session", () => tuiRow(null)],
  ])("#given %s #when status runs #then last_activity_at is null, never invented", async (_label, row) => {
    const result = await runWith(JSON.stringify({ endpoints: [row(scratch())] }))
    expect(JSON.parse(result.stdout).endpoints[0].last_activity_at).toBeNull()
  })

  test("#given the engine exits 3 with its inventory line #when status runs #then the exit code is kept and the line is still enriched", async () => {
    const result = await runWith(JSON.stringify({ endpoints: [{ ...tuiRow(null), reachable: false, alive: false, reason: "dead" }] }), 3)
    expect({ code: result.code, activity: JSON.parse(result.stdout).endpoints[0].last_activity_at }).toEqual({ code: 3, activity: null })
  })

  test("#given the engine prints no inventory JSON #when status runs #then its stdout passes through unchanged", async () => {
    const result = await runWith("not json\n", 2)
    expect({ code: result.code, stdout: result.stdout }).toEqual({ code: 2, stdout: "not json\n" })
  })

  test.each([
    [["host", "status", "--all", "--json"], true],
    [["host", "status", "--json", "--all", "--include-workers"], true],
    [["host", "status", "--json"], false],
    [["host", "gc", "--all"], false],
    [["thread", "status", "--all"], false],
  ])("#given argv %p #when classified #then status --all is %p", (args, expected) => {
    expect(isHostStatusAll(args, {})).toBe(expected)
  })

  test("#given the raw marker the compiled binary sets on its own engine call #when classified #then it goes to the engine untouched", () => {
    expect(isHostStatusAll(["host", "status", "--all"], { [HOST_STATUS_RAW_ENV]: "1" })).toBe(false)
  })
})

describe("omo host status --all: the session reader", () => {
  test("#given the plugin's thread SDK #when the reader runs #then it is the SDK's readSessionFacts updated_at, and a plugin without the SDK reads null", async () => {
    const plugin = scratch()
    mkdirSync(join(plugin, "runtime", "thread-sdk"), { recursive: true })
    writeFileSync(join(plugin, "runtime", "thread-sdk", "sdk.js"), "export function readSessionFacts(path) { return path === '/known' ? { updated_at: '2026-09-30T02:00:00.000Z' } : null }\n")
    const read = await sessionActivityReader(plugin)
    expect([read("/known"), read("/other")]).toEqual(["2026-09-30T02:00:00.000Z", null])
    const missing = await sessionActivityReader(join(plugin, "absent"))
    expect(missing("/known")).toBeNull()
  })
})
