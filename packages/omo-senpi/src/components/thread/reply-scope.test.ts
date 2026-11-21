import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
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

const elsewhere = (durableSessionId: string, name: string): ThreadHostSession => ({
  sessionId: `route-${name}`,
  durableSessionId,
  cwd: process.cwd(),
  name,
  status: "open",
})

function receiver() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "thread-reply-scope-")))
  roots.push(root)
  return surface(undefined, {
    callerWorkspaceRoot: root,
    sessions: [elsewhere(SENDER_ID, "sender lane"), elsewhere(OTHER_ID, "other lane")],
    callerReplyTargets: () => [SENDER_ID],
    callerReplySenders: () => [{ session_id: SENDER_ID, name: "sender lane" }],
  })
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

  test("#given no delivery was consumed #when the receiver sends to a session in another workspace without all_scope #then it is scope_denied", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "thread-reply-scope-")))
    roots.push(root)
    const { run, enqueuedFor } = surface(undefined, {
      callerWorkspaceRoot: root,
      sessions: [elsewhere(SENDER_ID, "sender lane")],
    })
    expect(await run("thread_send", { thread: SENDER_ID, message: "hi" })).toMatchObject({
      kind: "error",
      error: { code: "scope_denied" },
    })
    expect(enqueuedFor(SENDER_ID)).toBe(0)
  })
})
