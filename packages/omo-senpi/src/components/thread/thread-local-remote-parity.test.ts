import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolResult } from "./contracts"
import { readTranscript } from "./reader"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

/**
 * Owner ruling: a thread operation behaves the same on this device and on another one (same result shape, same errors),
 * and "online" is a property of a device, never of a thread: a thread no engine runs still exists and is addressable.
 * Each parity row runs one assertion on both legs: this device's fake host (`local`) and device b (`remote`).
 */
type Leg = "local" | "remote"
const LEGS: readonly Leg[] = ["local", "remote"]

const { account, surface, cleanup } = createRemoteThreadFixture()
const scratch: string[] = []
afterEach(async () => {
  await cleanup()
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A closed thread's session file where senpi writes it: `<agentDir>/sessions/--<encoded cwd>--/<timestamp>_<id>.jsonl`. */
function writeSessionFile(agentDir: string, id: string): string {
  const cwd = process.cwd()
  const directory = join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`)
  mkdirSync(directory, { recursive: true })
  const lines = [
    { type: "session", id, timestamp: "2026-11-14T08:32:29.143Z", cwd },
    { type: "message", timestamp: "2026-11-14T08:32:40.000Z", message: { role: "user", content: "before the close" } },
    { type: "message", timestamp: "2026-11-14T08:32:41.000Z", message: { role: "assistant", content: "noted" } },
  ]
  const path = join(directory, `2026-11-14T08-32-29-143Z_${id}.jsonl`)
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)
  return path
}

function notRunning(leg: Leg) {
  if (leg === "local") {
    const local = surface(undefined, { sessions: [], sessionsDirectory: true })
    writeSessionFile(local.agentDir, "dur-closed")
    return { run: local.run, id: "dur-closed" }
  }
  return { run: surface(account({ rowState: "ended", live: [] }).remote).run, id: "dur-on-b" }
}

const errorOf = (result: ThreadToolResult) => (result.kind === "error" ? result.error : undefined)

test("durable thread_read spends its window and budget on messages, but binds cursors to the whole file", async () => {
  const { run, agentDir } = surface(undefined, { sessions: [], sessionsDirectory: true })
  const thread = "dur-bookkeeping"
  const path = writeSessionFile(agentDir, thread)
  const messages = Array.from({ length: 62 }, (_, index) => ({
    role: "assistant",
    content: `${index}:` + "x".repeat(index === 61 ? 5000 : 850),
  }))
  const hidden = { type: "custom", customType: "session-lifecycle", data: "h".repeat(4200) }
  const append = (row: unknown) => appendFileSync(path, `${JSON.stringify(row)}\n`)
  for (const message of messages) {
    append({ type: "message", message, id: message.content.slice(0, 3), padding: "p".repeat(3500) })
    append(hidden)
  }
  for (let i = 0; i < 60; i++) append(i % 2 === 0 ? hidden : { type: "message", message: { role: "custom" } })

  const readPage = async (args: { max_bytes?: number; cursor?: string }) => {
    const page = await run("thread_read", { thread, ...args })
    if (page.kind !== "ok" || !("items" in page)) throw new Error("expected transcript page")
    expect(page.source).toBe("session_jsonl")
    expect(page.source_incomplete).toBe(true)
    expect(page.truncated).toBe(page.next_cursor !== undefined)
    return { contents: page.items.map((item) => item.content), cursor: page.next_cursor }
  }
  const expected = messages.slice(-60).map((message) => JSON.stringify(message.content))
  expect(await readPage({})).toEqual({ contents: expected, cursor: undefined })
  const small = { max_bytes: 4096 }
  const first = await readPage(small)
  expect(first.contents).toEqual(expected.slice(-1)) // The newest message alone exceeds 4 KiB.
  if (!first.cursor) throw new Error("expected older messages")
  const older = { ...small, cursor: first.cursor }
  const second = await readPage(older)
  expect(second.contents).toEqual(expected.slice(-5, -1)) // Four payloads fit, not four wrappers.
  expect(await readPage(older)).toEqual(second)
  const seen = [...second.contents, ...first.contents]
  let cursor = second.cursor
  while (cursor !== undefined) {
    const page = await readPage({ ...small, cursor })
    expect(page.contents.length).toBeGreaterThan(0)
    seen.unshift(...page.contents)
    expect(seen.length).toBeLessThanOrEqual(expected.length)
    cursor = page.cursor
  }
  expect(seen).toEqual(expected)

  const raw = readTranscript({ kind: "jsonl", path }, small)
  if (raw.kind !== "ok" || !raw.next_cursor) throw new Error("expected raw entry cursor")
  expect(errorOf(await run("thread_read", { thread, cursor: raw.next_cursor }))?.code).toBe("cursor_stale")
  append(hidden)
  expect(errorOf(await run("thread_read", { thread, ...older }))?.code).toBe("cursor_stale")
})

describe("B1: a thread no engine runs answers every tool the same way, and never not_found while its file exists", () => {
  test.each(LEGS)(
    "#given a thread on the %s leg that no engine runs #when thread_interrupt and thread_rename name it #then both answer not_resumable",
    async (leg) => {
      const { run, id } = notRunning(leg)
      expect(await run("thread_interrupt", { thread: id })).toMatchObject({
        kind: "error",
        error: { code: "not_resumable" },
      })
      expect(await run("thread_rename", { thread: id, name: "renamed" })).toMatchObject({
        kind: "error",
        error: { code: "not_resumable" },
      })
    },
  )

  test("#given a not-running thread on each leg #when every control tool names it #then both legs answer the same refusal", async () => {
    const local = notRunning("local")
    const remote = notRunning("remote")
    for (const [tool, args] of [
      ["thread_interrupt", {}],
      ["thread_rename", { name: "renamed" }],
      ["thread_set_model", { model: "opus" }],
      ["thread_set_reasoning", { level: "low" }],
    ] as const) {
      const here = errorOf(await local.run(tool, { thread: local.id, ...args }))
      const there = errorOf(await remote.run(tool, { thread: remote.id, ...args }))
      expect(here).toBeDefined()
      expect(here).toEqual(there)
    }
  })

  test("#given a closed thread on this device with its session file #when thread_send, thread_read, thread_interrupt and thread_rename name it #then send queues it offline, read answers from the file, and the controls answer not_resumable", async () => {
    const { run, id } = notRunning("local")
    expect(await run("thread_send", { thread: id, message: "still there?" })).toMatchObject({
      kind: "ok",
      thread: id,
      delivery: { kind: "queued_offline" },
    })
    expect(await run("thread_read", { thread: id })).toMatchObject({
      kind: "ok",
      thread: id,
      source: "session_jsonl",
      source_incomplete: true,
      items: [
        { seq: 1, role: "user", content: JSON.stringify("before the close") },
        { seq: 2, role: "assistant", content: JSON.stringify("noted") },
      ],
    })
    expect(errorOf(await run("thread_interrupt", { thread: id }))?.code).toBe("not_resumable")
    expect(errorOf(await run("thread_rename", { thread: id, name: "renamed" }))?.code).toBe("not_resumable")
  })
})

describe("#13215: a session another device holds but lists nowhere answers read and controls as it does on its own device", () => {
  // The account listing carries only sessions an engine serves: b's closed session is found only by the id probe (A4.3.3).
  const CLOSED = "0195f0c2-1a2b-7c3d-8e4f-00000000d001"
  const unlisted = (leg: Leg) => {
    if (leg === "local") {
      const local = surface(undefined, { sessions: [], sessionsDirectory: true })
      writeSessionFile(local.agentDir, CLOSED)
      return { run: local.run, lookups: [] as readonly unknown[] }
    }
    const b = account({ wakeFeature: true, ended: { b: { [CLOSED]: "rk-closed" } } })
    return { run: surface(b.remote).run, lookups: b.lookups }
  }

  test("#given a closed session on b that b lists nowhere #when thread_read names it by session id on device a #then the id probe finds it on b and it answers not_resumable, never not_found", async () => {
    const remote = unlisted("remote")
    expect(errorOf(await remote.run("thread_read", { thread: CLOSED }))).toMatchObject({ code: "not_resumable" })
    expect(remote.lookups).toEqual([{ device: "b", durable_id: CLOSED }])
  })

  test("#given a closed session by session id on each leg #when every control tool names it #then both legs answer the same refusal", async () => {
    const local = unlisted("local")
    const remote = unlisted("remote")
    for (const [tool, args] of [
      ["thread_interrupt", {}],
      ["thread_rename", { name: "renamed" }],
      ["thread_set_model", { model: "opus" }],
      ["thread_set_reasoning", { level: "low" }],
    ] as const) {
      const here = errorOf(await local.run(tool, { thread: CLOSED, ...args }))
      const there = errorOf(await remote.run(tool, { thread: CLOSED, ...args }))
      expect(here?.code).toBe("not_resumable")
      expect(there).toEqual(here)
    }
    const withoutDevice = ({ device: _device, ...rest }: Record<string, unknown>) => rest
    const closedHere = (await local.run("thread_close", { thread: CLOSED })) as Record<string, unknown>
    const closedThere = (await remote.run("thread_close", { thread: CLOSED })) as Record<string, unknown>
    expect(closedHere).toMatchObject({ kind: "ok", closed: false, reason: "not_live" })
    expect(withoutDevice(closedThere)).toEqual(withoutDevice(closedHere))
  })
})

const ENGINE_STATE = {
  lifecycle: { state: "done", seq: 0, epoch: 0 },
  paused: false,
  pendingQuestions: [],
  permissionPreset: "full-access",
  sessionPath: "/home/a/.omo/agent/sessions/x.jsonl",
  socket: "/tmp/i-0123456789abcdef.sock",
  endpoint_kind: "rpc_host",
  controls: ["send", "read"],
}
// A create given no prompt says `prompt: null` on both legs, beside the thread's summary.
const SUMMARY_KEYS = ["created_at", "cwd", "link", "name", "prompt", "state", "status", "thread", "updated_at"]
const threadKeys = (result: ThreadToolResult) => {
  if (result.kind !== "ok" || !("thread" in result)) throw new Error(`expected a thread, got ${JSON.stringify(result)}`)
  return Object.keys(result)
    .filter((key) => key !== "device" && key !== "kind" && key !== "deduplicated")
    .sort()
}

describe("B2: thread_create answers one summary shape on both legs", () => {
  test("#given each leg's engine answers open_session with its whole state #when thread_create makes a thread there #then both answer the same summary keys, device aside, and no engine state", async () => {
    const local = surface(undefined)
    local.openSession.mockImplementationOnce(
      async () =>
        ({
          sessionId: "route-created",
          durableSessionId: "dur-created-here",
          cwd: process.cwd(),
          name: null,
          status: "open",
          ...ENGINE_STATE,
        }) as ThreadHostSession,
    )
    const b = account({
      openData: { sessionId: "rpc-9", state: { durableSessionId: "dur-new-on-b", ...ENGINE_STATE } },
    })
    const here = await local.run("thread_create", { name: "thread-local-remote-parity-150" })
    const there = await surface(b.remote).run("thread_create", {
      name: "thread-local-remote-parity-151",
      device: "studio",
    })
    expect(here).toMatchObject({ kind: "ok", thread: "dur-created-here" })
    expect(there).toMatchObject({ kind: "ok", thread: "dur-new-on-b", device: "b" })
    expect(threadKeys(here)).toEqual(SUMMARY_KEYS)
    expect(threadKeys(there)).toEqual(SUMMARY_KEYS)
  })
})

describe("B3: a thread created outside the caller's workspace says how to address it", () => {
  test("#given a folder outside the caller's workspace #when thread_create makes a thread there on this device #then the result says it is outside and that all_scope addresses it, and it does", async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "thread-away-")))
    scratch.push(folder)
    const sessions: ThreadHostSession[] = []
    const local = surface(undefined, { sessions })
    local.openSession.mockImplementationOnce(async (request) => {
      const opened: ThreadHostSession = {
        sessionId: "route-away",
        durableSessionId: "dur-away",
        cwd: request.cwd ?? "",
        name: null,
        status: "open",
      }
      sessions.push(opened)
      return opened
    })
    const created = await local.run("thread_create", { name: "thread-local-remote-parity-176", cwd: folder })
    expect(created).toMatchObject({
      kind: "ok",
      thread: "dur-away",
      cwd: folder,
      workspace_scope: "outside",
    })
    expect(typeof (created as { scope_next_action?: unknown }).scope_next_action).toBe("string")
    expect(errorOf(await local.run("thread_read", { thread: "dur-away" }))?.code).toBe("scope_denied")
    expect(await local.run("thread_read", { thread: "dur-away", all_scope: true })).toMatchObject({
      kind: "ok",
      thread: "dur-away",
    })
  })

  test.each(LEGS)(
    "#given a thread the %s leg creates that its caller addresses without all_scope #when thread_create answers #then the result carries no workspace note",
    async (leg) => {
      const created =
        leg === "local"
          ? await surface(undefined).run("thread_create", { name: "thread-local-remote-parity-195" })
          : await surface(account().remote).run("thread_create", {
              name: "thread-local-remote-parity-196",
              device: "studio",
            })
      expect(created).toMatchObject({ kind: "ok" })
      expect(created).not.toHaveProperty("workspace_scope")
      expect(created).not.toHaveProperty("scope_next_action")
    },
  )
})
