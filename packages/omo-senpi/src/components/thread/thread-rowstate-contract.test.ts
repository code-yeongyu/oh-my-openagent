import { afterEach, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeHostTransport } from "../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host-transport"
import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface } from "./live-surface"
import { createThreadTools } from "./tools"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import { guardedResume } from "./control/resume"
import { createThreadSdk } from "./sdk"

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

test("human resume output reports the hold release, never delivery, and prints each refusal", async () => {
  const { runThreadCommand } = await import(new URL("../../../../omo-native/bin/lib/thread.js", import.meta.url).href)
  for (const reason of [
    undefined,
    "not_paused",
    "stopped",
    "resume_through_parent",
    "stale",
    "unsupported",
    "guard_support_unproven",
    "identity_mismatch",
    "unrecognized_hold",
    "engine_turn_cap",
  ]) {
    let output = ""
    const capture = {
      write: (s: string) => {
        output += s
      },
    }
    const result = reason
      ? {
          kind: "error",
          error: { code: "not_resumable", message: `not resumed (${reason})`, next_action: "Read current state." },
        }
      : { kind: "ok", thread: "target", resumed: true, turn_started: true, held_deliveries: 3 }
    const exit = await runThreadCommand(["resume", "target"], {
      platform: "linux",
      env: {},
      pluginRoot: "/unused",
      stdout: capture,
      stderr: capture,
      importThreadClient: async () => ({}),
      importSdk: async () => ({ createThreadSdk: () => ({ resume: async () => result, dispose: async () => {} }) }),
    })
    expect(exit).toBe(reason ? 1 : 0)
    expect(output).toContain(reason ?? "Held peer deliveries before resume: 3")
  }
})

test("remote resume is refused before dispatch even for a live interrupted listing", async () => {
  const b = fixture.account({
    liveState: { paused: true, pause: { pauseSeq: 2, records: [{ kind: "session_hold", key: "interrupted-run" }] } },
  })
  const { run } = fixture.surface(b.remote)
  const answer = await run("thread_create", { thread: B_ROW.durable_id, resume: true })
  expect(answer).toMatchObject({
    kind: "error",
    error: { code: "unsupported", details: { reason: "guard_support_unproven" } },
  })
  expect(b.sent.some((frame) => frame.via === "wake" || frame.rpc?.type === "resume_session")).toBe(false)
})

test("only one guarded resume is sent for an interrupted session; Stop, missing guards and target changes run nothing", async () => {
  const hold = { kind: "session_hold", key: "interrupted-run" }
  const caps = ["session_row_hold", "resume_session"]
  for (const [name, capabilities, selected, records, seq, shouldRun] of [
    ["interrupted", caps, "selected", [hold], 2, true],
    ["unattended reopen", caps, "selected", [hold, { kind: "unattended", key: "unattended" }], 2, true],
    [
      "third hold",
      caps,
      "selected",
      [hold, { kind: "unattended", key: "unattended" }, { kind: "unattended", key: "closing" }],
      3,
      false,
    ],
    ["fenced", caps, "selected", [hold, { kind: "run_fence", key: "private" }], 3, false],
    ["stopped", caps, "selected", [hold, { kind: "session_hold", key: "session_hold:3" }], 3, false],
    ["parent", caps, "selected", [{ kind: "inherited_hold", key: "inherited_hold" }], 2, false],
    ["unknown", caps, "selected", [{ kind: "new-kind", key: "other" }], 2, false],
    ["missing sequence", caps, "selected", [hold], undefined, false],
    ["changed identity", caps, "different", [hold], 2, false],
    ["old engine", ["resume_session"], "selected", [hold], 2, false],
  ] as const) {
    const sent: Readonly<Record<string, unknown>>[] = []
    const result = await guardedResume("selected", { capabilities }, async (command) => {
      sent.push(command)
      return command.type === "get_state"
        ? { sessionId: selected, paused: true, pause: { pauseSeq: seq, records } }
        : { resumed: true, turnStarted: true }
    })
    expect(result.kind, name).toBe(shouldRun ? "ok" : "error")
    expect(
      sent.filter((c) => c.type === "resume_session"),
      name,
    ).toEqual(shouldRun ? [{ type: "resume_session", expectedSeq: 2, unlessStopped: true }] : [])
    if (name === "old engine") expect(sent).toHaveLength(0)
  }
  const raced = await guardedResume("selected", { capabilities: caps }, async (command) =>
    command.type === "get_state"
      ? { sessionId: "selected", paused: true, pause: { pauseSeq: 2, records: [hold] } }
      : { resumed: false, reason: "stopped", turnStarted: false, pauseSeq: 3 },
  )
  expect(raced).toMatchObject({
    kind: "error",
    error: { details: { reason: "stopped" }, next_action: expect.stringContaining("person") },
  })
})

test("reading a held peer reports the same whitelisted hold as its row", async () => {
  const hold = {
    kind: "session_hold",
    key: "interrupted-run",
    since: new Date(0).toISOString(),
    queue_depth: 3,
  } as const
  const b = fixture.account({ rows: [{ ...B_ROW, liveness: { kind: "held", hold: { ...hold, data: "private" } } }] })
  const { run } = fixture.surface(b.remote)
  const list = await run("thread_list", { all_scope: true })
  if (!("threads" in list)) throw new Error("no rows")
  const row = list.threads.find((item) => item.thread === B_ROW.durable_id)
  expect(row?.state).toBe("held")
  expect(row?.hold).toEqual(hold)
  const read = await run("thread_read", { thread: B_ROW.durable_id, all_scope: true })
  expect(read).toMatchObject({ kind: "ok", state: "held", hold })
  expect(JSON.stringify(read)).not.toContain('"data":"private"')
})

test("device A preserves B's per-host evidence without treating a legacy row as verified", async () => {
  const legacy = { ...B_ROW, durable_id: "legacy", session_id: "r0" }
  const fast = { ...B_ROW, durable_id: "fast", session_id: "r1", liveness: { kind: "running", activity: "running" } }
  const slow = {
    ...B_ROW,
    durable_id: "slow",
    session_id: "r2",
    liveness: { kind: "unknown", host: "engine-b2", reason: "host_not_answering" },
  }
  const b = fixture.account({ rows: [legacy, fast, slow] })
  const { run } = fixture.surface(b.remote)
  const result = await run("thread_list", { all_scope: true })
  if (!("threads" in result)) throw new Error("no rows")
  const row = (id: string) => result.threads.find((item) => item.thread === id)
  expect(row("legacy")).toMatchObject({ state: "idle", verification: "unverified" })
  expect(row("fast")).toMatchObject({ state: "running", liveness: fast.liveness })
  expect(row("slow")).toMatchObject({ state: "unknown", liveness: slow.liveness })
  expect(result.devices?.find((device) => device.device === "b")).toMatchObject({ host_counts: null })
})

test("one host missing the listing deadline cannot turn its claimed session inactive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "row-"))
  const fast = join(dir, "rpc.sock")
  const slow = join(dir, "i-0123456789abcdef.sock")
  const file = join(dir, "slow.jsonl")
  const transport = fakeHostTransport(fast)
  let wakes = 0
  const resumes: { expectedSeq: number; unlessStopped: boolean }[] = []
  let stopped = false
  const slowTransport = fakeHostTransport(slow)
  const store = createGatewayStore({ agentDir: dir })
  const serverFor = (endpoint: typeof transport, id: string) =>
    createServer((socket) =>
      endpoint.authenticate(socket, () => {
        socket.setEncoding("utf8")
        let pending = ""
        socket.on("data", (chunk) => {
          pending += chunk
          for (let end: number; (end = pending.indexOf("\n")) >= 0;) {
            const frame = JSON.parse(pending.slice(0, end))
            if (frame.type === "wake") wakes++
            if (frame.type === "resume_session")
              resumes.push({ expectedSeq: frame.expectedSeq, unlessStopped: frame.unlessStopped })
            pending = pending.slice(end + 1)
            const data =
              frame.type === "list_sessions"
                ? { sessions: [{ sessionId: "rpc-1", durableSessionId: id, cwd: process.cwd(), activity: "running" }] }
                : frame.type === "get_state"
                  ? {
                      sessionId: id,
                      paused: true,
                      pause: {
                        pauseSeq: 2,
                        records: [{ kind: "session_hold", key: stopped ? "session_hold:2" : "interrupted-run" }],
                      },
                    }
                  : frame.type === "resume_session"
                    ? { resumed: true, turnStarted: true }
                    : { capabilities: ["session_row_hold", "resume_session", "attach_session"] }
            socket.write(
              `${JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data })}\n`,
            )
          }
        })
      }),
    )
  const server = serverFor(transport, "fast")
  const recovering = serverFor(slowTransport, "slow")
  try {
    writeFileSync(
      file,
      JSON.stringify({ type: "session", id: "slow", cwd: process.cwd(), timestamp: new Date(0).toISOString() }) + "\n",
    )
    const listening = once(server, "listening")
    server.listen(transport.listenAddress)
    await listening
    const ready = once(recovering, "listening")
    recovering.listen(slowTransport.listenAddress)
    await ready
    let now = 1000
    let expired = 0
    let fault = true
    const host = createLiveThreadSurface(undefined, {
      env: { HOME: dir, SENPI_RPC_SOCKET: fast },
      exists: (path) => path === fast || path === slow,
      registry: async () => [],
      statusAll: async () => [
        { socket: fast, reachable: true, session_paths: [] },
        { socket: slow, reachable: true, session_paths: [file] },
      ],
      now: () => now,
      connect: (path) => {
        if (path === transport.listenAddress || !fault) return createConnection(path)
        now += 10_001
        expired++
        throw new Error("thread RPC request timed out")
      },
    })
    const tools = createThreadTools({
      host,
      store,
      stateDirectory: dir,
      callerSessionId: () => "caller",
      callerWorkspaceRoot: () => process.cwd(),
    })
    const list = tools.find((tool) => tool.name === "thread_list")
    if (!list) throw new Error("thread_list missing")
    const result = (await list.execute("list", { all_scope: true }, undefined, undefined, undefined as never)).details
      .result
    expect(expired).toBe(1)
    expect(result.kind).toBe("ok")
    expect(result).toHaveProperty("host_counts", { answered: 1, unanswered: 1 })
    if (!("threads" in result)) throw new Error("no rows")
    const rows: readonly { thread: string; state?: string }[] = result.threads
    expect(rows.find((row) => row.thread === "fast")?.state).toBe("running")
    const row = rows.find((row) => row.thread === "slow")
    if (row?.state === "inactive") {
      expect(row).toMatchObject({ status: "resumable", state: "inactive", error_note: "live_unresponsive" })
    }
    expect(row).toMatchObject({ state: "unknown" })
    const send = tools.find((tool) => tool.name === "thread_send")
    if (!send) throw new Error("thread_send missing")
    const args = { thread: "slow", message: "once", idempotency_key: "same-key-after-timeout", all_scope: true }
    const before = await store.backlogs(["slow"])
    const refusal = (await send.execute("send", args, undefined, undefined, undefined as never)).details.result
    expect(refusal).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { retry: true, reason: "host_not_answering" } },
    })
    expect(await store.backlogs(["slow"])).toEqual(before)
    expect(wakes).toBe(0)
    fault = false
    const cleared = (await list.execute("after", { all_scope: true }, undefined, undefined, undefined as never)).details
      .result
    expect(cleared).toHaveProperty("host_counts", { answered: 2, unanswered: 0 })
    if (!("threads" in cleared)) throw new Error("no rows after recovery")
    expect(cleared.threads.find((item: { thread: string }) => item.thread === "slow")).toMatchObject({
      state: "running",
      liveness: { kind: "running", activity: "running" },
    })
    const retried = (await send.execute("retry", args, undefined, undefined, undefined as never)).details.result
    expect(retried).toMatchObject({ kind: "ok", deduplicated: false })
    expect(wakes).toBe(1)
    const create = tools.find((tool) => tool.name === "thread_create")
    if (!create) throw new Error("thread_create missing")
    const sdk = createThreadSdk({ agentDir: dir, cwd: process.cwd(), uid: 1, user: "test", host, store })
    const argsResume = { thread: "slow", resume: true as const }
    const calls = [
      async () =>
        (await create.execute(`resume-${stopped}`, argsResume, undefined, undefined, undefined as never)).details
          .result,
      () => sdk.create(argsResume),
      () => sdk.resume({ thread: "slow" }),
      async () => {
        const { runThreadCommand } = await import(
          new URL("../../../../omo-native/bin/lib/thread.js", import.meta.url).href
        )
        let out = ""
        await runThreadCommand(["resume", "slow", "--json"], {
          platform: "linux",
          cwd: process.cwd(),
          agentDir: dir,
          pluginRoot: dir,
          env: {},
          stdout: {
            write: (s: string) => {
              out += s
            },
          },
          stderr: { write: () => {} },
          importThreadClient: async () => ({}),
          importSdk: async () => ({ createThreadSdk: () => ({ ...sdk, dispose: async () => {} }) }),
        })
        return JSON.parse(out)
      },
    ]
    try {
      for (stopped of [false, true]) {
        const answers = []
        for (const call of calls) answers.push(await call())
        for (const answer of answers) expect(answer).toEqual(answers[0])
        expect(answers[0]).toMatchObject(
          stopped
            ? { kind: "error", error: { details: { reason: "stopped" } } }
            : { kind: "ok", resumed: true, turn_started: true },
        )
      }
      expect(resumes).toEqual(calls.map(() => ({ expectedSeq: 2, unlessStopped: true })))
    } finally {
      await sdk.dispose()
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => recovering.close(() => resolve()))
    await store.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
