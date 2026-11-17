import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

// #14044: a thread is addressable by a unique prefix of its durable id (at least 8 hex characters) once id, alias and
// name all miss, across this device's book and the account listing; a reply resolves only by the sender's exact id/name.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const LOCAL_ID = "01a1e898-0000-7000-8000-00000000000a"
const REMOTE_ID = "01a1e898-0000-7000-8000-00000000000b"
const CALLER_ID = "01a1e898-0000-7000-8000-00000000000c"

const localSession = (durableSessionId: string, name: string): ThreadHostSession => ({
  sessionId: `route-${name}`,
  durableSessionId,
  cwd: process.cwd(),
  name,
  status: "open",
})

const remoteRow = { ...B_ROW, session_id: "rk-prefix", durable_id: REMOTE_ID, title: "prefixed on b" }

describe("#14044: a unique durable-id prefix addresses a thread", () => {
  test("#given one local thread whose id starts with 01a1e898 #when thread_send names that 8-char prefix #then it is delivered to that thread", async () => {
    const { run, enqueuedFor } = surface(undefined, { sessions: [localSession(LOCAL_ID, "alpha")] })
    expect(await run("thread_send", { thread: "01a1e898", message: "hi" })).toMatchObject({
      kind: "ok",
      thread: LOCAL_ID,
    })
    expect(enqueuedFor(LOCAL_ID)).toBe(1)
  })

  test("#given a thread on device b whose id starts with 01a1e898 #when thread_send names that prefix #then it reaches b", async () => {
    const a = account({ rows: [remoteRow], live: [remoteRow.session_id] })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "01a1e898", message: "hi" })).toMatchObject({
      kind: "ok",
      thread: REMOTE_ID,
      device: "b",
    })
  })

  test("#given a local and a remote thread sharing the prefix #when thread_send names it #then it is ambiguous_target naming both threads and nothing is sent", async () => {
    const a = account({ rows: [remoteRow], live: [remoteRow.session_id] })
    const { run, enqueuedFor } = surface(a.remote, { sessions: [localSession(LOCAL_ID, "alpha")] })
    const result = await run("thread_send", { thread: "01a1e898", message: "hi" })
    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const candidates = (result as { error: { details?: { candidates?: readonly { thread: string }[] } } }).error.details
      ?.candidates
    expect(candidates?.map((candidate) => candidate.thread).sort()).toEqual([LOCAL_ID, REMOTE_ID])
    expect(enqueuedFor(LOCAL_ID)).toBe(0)
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toEqual([])
  })

  test("#given a thread whose id starts with 01a1e898 #when thread_send names only 7 characters of it #then it is not_found", async () => {
    const { run, enqueuedFor } = surface(undefined, { sessions: [localSession(LOCAL_ID, "alpha")] })
    expect(await run("thread_send", { thread: "01a1e89", message: "hi" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(enqueuedFor(LOCAL_ID)).toBe(0)
  })

  test("#given a consumed sender whose stated name is 01a1e898 #when the reply names it #then it never resolves by prefix to the other thread", async () => {
    const { run, enqueuedFor } = surface(undefined, {
      sessions: [localSession(LOCAL_ID, "alpha")],
      callerReplySenders: () => [{ session_id: "dur-sender", name: "01a1e898" }],
    })
    expect(await run("thread_send", { thread: "01a1e898", message: "reply" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(enqueuedFor(LOCAL_ID)).toBe(0)
  })
})

describe("#14067 review: the caller is no prefix candidate for a send or a handoff, and stays one for a control", () => {
  const withCaller = () =>
    surface(undefined, {
      caller: CALLER_ID,
      sessions: [localSession(CALLER_ID, "me"), localSession(LOCAL_ID, "alpha")],
    })

  test.each(["thread_send", "thread_handoff"] as const)(
    "#given the caller's id shares the 8-char prefix with one other thread #when %s names that prefix #then it reaches the other thread",
    async (tool) => {
      const { run, enqueuedFor } = withCaller()
      expect(await run(tool, { thread: "01a1e898", message: "hi" })).toMatchObject({ kind: "ok", thread: LOCAL_ID })
      expect(enqueuedFor(LOCAL_ID)).toBe(1)
      expect(enqueuedFor(CALLER_ID)).toBe(0)
    },
  )

  test("#given the caller's id shares the 8-char prefix with one other thread #when thread_read names that prefix #then it is ambiguous_target naming both", async () => {
    const result = await withCaller().run("thread_read", { thread: "01a1e898" })
    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const candidates = (result as { error: { details?: { candidates?: readonly { thread: string }[] } } }).error.details
      ?.candidates
    expect(candidates?.map((candidate) => candidate.thread).sort()).toEqual([LOCAL_ID, CALLER_ID])
  })

  test("#given one thread whose id starts with 01a1e898 #when thread_read names that prefix #then it reads that thread", async () => {
    const { run } = surface(undefined, { sessions: [localSession(LOCAL_ID, "alpha")] })
    expect(await run("thread_read", { thread: "01a1e898" })).toMatchObject({ kind: "ok", thread: LOCAL_ID })
  })
})
