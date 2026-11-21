import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

// A delivery from a session in another workspace grants its receiver a reply to that sender without all_scope, for as
// long as the reply allowance lasts (`component.ts` `noteInput`); every other session outside the workspace stays
// scope_denied without it.

const { surface, cleanup } = createRemoteThreadFixture()
const roots: string[] = []
afterEach(async () => {
  await cleanup()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const SENDER_ID = "01a1f000-0000-7000-8000-00000000000a"
const OTHER_ID = "01a1f000-0000-7000-8000-00000000000b"

type Sender = { readonly session_id: string; readonly name?: string }

const elsewhere = (durableSessionId: string, name: string): ThreadHostSession => ({
  sessionId: `route-${name}`,
  durableSessionId,
  cwd: process.cwd(),
  name,
  status: "open",
})

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "thread-reply-scope-")))
  roots.push(root)
  return root
}

function receiver(
  sessions: ThreadHostSession[] = [elsewhere(SENDER_ID, "sender lane"), elsewhere(OTHER_ID, "other lane")],
  senders: () => readonly Sender[] = () => [{ session_id: SENDER_ID, name: "sender lane" }],
) {
  return surface(undefined, {
    callerWorkspaceRoot: workspace(),
    sessions,
    callerReplyTargets: () => senders().map((sender) => sender.session_id),
    callerReplySenders: senders,
  })
}

function writeSessionFile(agentDir: string, id: string, name?: string): void {
  const cwd = process.cwd()
  const directory = join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`)
  mkdirSync(directory, { recursive: true })
  const lines = [
    { type: "session", id, timestamp: "2026-11-14T08:32:29.143Z", cwd },
    ...(name === undefined ? [] : [{ type: "session_info", name, timestamp: "2026-11-14T08:32:30.000Z" }]),
  ]
  writeFileSync(
    join(directory, `2026-11-14T08-32-29-143Z_${id}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  )
}

describe("a reply to a sender in another workspace", () => {
  test("#given a delivery from a session in another workspace #when the receiver replies by the sender's id without all_scope #then it is delivered to that sender", async () => {
    const { run, enqueuedFor } = receiver()
    expect(await run("thread_send", { thread: SENDER_ID, message: "reply" })).toMatchObject({
      kind: "ok",
      thread: SENDER_ID,
    })
    expect(enqueuedFor(SENDER_ID)).toBe(1)
  })

  test("#given a delivery from a session in another workspace #when the receiver replies by the sender's stated name without all_scope #then it is delivered to that sender", async () => {
    const { run, enqueuedFor } = receiver()
    expect(await run("thread_send", { thread: "sender lane", message: "reply" })).toMatchObject({
      kind: "ok",
      thread: SENDER_ID,
    })
    expect(enqueuedFor(SENDER_ID)).toBe(1)
  })

  test("#given the sender renamed itself after sending #when the receiver replies by the name its delivery stated #then it is delivered to that sender by its recorded id", async () => {
    const { run, enqueuedFor } = receiver([elsewhere(SENDER_ID, "renamed lane")])
    expect(await run("thread_send", { thread: "sender lane", message: "reply" })).toMatchObject({
      kind: "ok",
      thread: SENDER_ID,
    })
    expect(enqueuedFor(SENDER_ID)).toBe(1)
  })

  test("#given an offline sender listed only by a session file that records no name #when the receiver replies by its stated name or its id #then both queue to that sender", async () => {
    const { run, enqueuedFor, agentDir } = surface(undefined, {
      callerWorkspaceRoot: workspace(),
      sessions: [],
      sessionsDirectory: true,
      callerReplyTargets: () => [SENDER_ID],
      callerReplySenders: () => [{ session_id: SENDER_ID, name: "sender lane" }],
    })
    writeSessionFile(agentDir, SENDER_ID)
    for (const thread of ["sender lane", SENDER_ID])
      expect(await run("thread_send", { thread, message: "reply" })).toMatchObject({
        kind: "ok",
        thread: SENDER_ID,
        delivery: { kind: "queued_offline" },
      })
    expect(enqueuedFor(SENDER_ID)).toBe(2)
  })
})

describe("the reply grant reaches only the sender", () => {
  test("#given a reply grant for one sender #when the receiver sends to an unrelated session in that other workspace without all_scope #then it is scope_denied and nothing is sent", async () => {
    const { run, enqueuedFor } = receiver()
    for (const thread of [OTHER_ID, "other lane"])
      expect(await run("thread_send", { thread, message: "not a reply" })).toMatchObject({
        kind: "error",
        error: { code: "scope_denied" },
      })
    expect(enqueuedFor(OTHER_ID)).toBe(0)
    expect(enqueuedFor(SENDER_ID)).toBe(0)
  })

  test("#given a second session in that workspace shares the sender's stated name #when the receiver replies by that name #then it is ambiguous_target and nothing is sent", async () => {
    const { run, enqueuedFor } = receiver([elsewhere(SENDER_ID, "sender lane"), elsewhere(OTHER_ID, "sender lane")])
    expect(await run("thread_send", { thread: "sender lane", message: "reply" })).toMatchObject({
      kind: "error",
      error: { code: "ambiguous_target" },
    })
    expect(enqueuedFor(OTHER_ID)).toBe(0)
    expect(enqueuedFor(SENDER_ID)).toBe(0)
  })

  test("#given the sender renamed itself and another session there now carries its stated name #when the receiver replies by that name #then it is reply_target_mismatch and nothing is sent", async () => {
    const { run, enqueuedFor } = receiver([elsewhere(SENDER_ID, "renamed lane"), elsewhere(OTHER_ID, "sender lane")])
    expect(await run("thread_send", { thread: "sender lane", message: "reply" })).toMatchObject({
      kind: "error",
      error: { code: "reply_target_mismatch" },
    })
    expect(enqueuedFor(OTHER_ID)).toBe(0)
    expect(enqueuedFor(SENDER_ID)).toBe(0)
  })

  test.each([
    ["name", "other lane"],
    ["id", OTHER_ID],
  ])(
    "#given a sender whose delivery states another session's %s as its own name #when the receiver replies by it #then it is reply_target_mismatch and nothing is sent",
    async (_kind, stated) => {
      const { run, enqueuedFor } = receiver(undefined, () => [{ session_id: SENDER_ID, name: stated }])
      expect(await run("thread_send", { thread: stated, message: "reply" })).toMatchObject({
        kind: "error",
        error: { code: "reply_target_mismatch" },
      })
      expect(enqueuedFor(OTHER_ID)).toBe(0)
      expect(enqueuedFor(SENDER_ID)).toBe(0)
    },
  )

  test("#given the reply allowance ended (a new message started work after a final answer) #when the receiver sends to the former sender without all_scope #then it is scope_denied", async () => {
    let senders: readonly Sender[] = [{ session_id: SENDER_ID, name: "sender lane" }]
    const { run, enqueuedFor } = receiver(undefined, () => senders)
    expect(await run("thread_send", { thread: SENDER_ID, message: "reply" })).toMatchObject({ kind: "ok" })
    senders = []
    for (const thread of [SENDER_ID, "sender lane"])
      expect(await run("thread_send", { thread, message: "later" })).toMatchObject({
        kind: "error",
        error: { code: "scope_denied" },
      })
    expect(enqueuedFor(SENDER_ID)).toBe(1)
  })

  test("#given no delivery was consumed #when the receiver sends to a session in another workspace without all_scope #then it is scope_denied", async () => {
    const { run, enqueuedFor } = receiver([elsewhere(SENDER_ID, "sender lane")], () => [])
    expect(await run("thread_send", { thread: SENDER_ID, message: "hi" })).toMatchObject({
      kind: "error",
      error: { code: "scope_denied" },
    })
    expect(enqueuedFor(SENDER_ID)).toBe(0)
  })
})
