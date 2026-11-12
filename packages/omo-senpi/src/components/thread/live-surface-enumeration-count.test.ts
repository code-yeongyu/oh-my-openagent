// #12989: how many endpoint enumerations (`host status --all`, one cold engine CLI process each) one thread_send starts.
// The count is taken twice: with a frozen clock (every step inside one cache window) and with every clock read more than
// a cache window after the previous one (a loaded device, where each step outlives the window).
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface, HOST_ENDPOINTS_CACHE_TTL_MS, type HostEndpointReport } from "./live-surface"
import type { RemoteThreadSurface } from "./remote/ports"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import { createThreadTools } from "./tools"

const SENDER_ID = "0b9f2c1e-4d3a-4b5c-8d6e-7f8091a2b3c4"
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function sessionFile(agentDir: string, id: string, name: string): void {
  const cwd = process.cwd()
  const dir = join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`)
  mkdirSync(dir, { recursive: true })
  const lines = [
    { type: "session", id, timestamp: "2026-11-12T10:00:00.000Z", cwd },
    { type: "message", timestamp: "2026-11-12T10:01:00.000Z", message: { role: "user", content: "an earlier turn" } },
    { type: "session_info", timestamp: "2026-11-12T10:02:00.000Z", name },
  ]
  writeFileSync(
    join(dir, `2026-11-12T10-00-00-000Z_${id}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  )
}

async function enumerationsForOneSend(clock: "frozen" | "spaced", send: "first" | "reply"): Promise<number> {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "thread-enum-count-")))
  cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }))
  sessionFile(agentDir, "dur-target", "target lane")
  sessionFile(agentDir, SENDER_ID, "sender lane")
  let time = 1_000
  let calls = 0
  const host = createLiveThreadSurface(undefined, {
    env: { HOME: agentDir, OMO_CODING_AGENT_DIR: agentDir, SENPI_RPC_SOCKET: join(agentDir, "rpc.sock") },
    registry: async () => [],
    statusAll: async (): Promise<readonly HostEndpointReport[]> => {
      calls += 1
      return []
    },
    now: () => (clock === "frozen" ? time : (time += HOST_ENDPOINTS_CACHE_TTL_MS + 1_000)),
  })
  const store = createGatewayStore({ agentDir })
  cleanups.push(() => store.dispose())
  const tools = createThreadTools({
    host,
    stateDirectory: agentDir,
    store,
    sessionsDirectory: () => join(agentDir, "sessions"),
    callerSessionId: () => "dur-caller",
    callerWorkspaceRoot: () => process.cwd(),
    callerReplyTargets: () => (send === "reply" ? [SENDER_ID] : []),
  })
  const sendTool = tools.find((tool) => tool.name === "thread_send")
  if (sendTool === undefined) throw new Error("thread_send is not registered")
  const output = await sendTool.execute(
    "call-1",
    { thread: send === "reply" ? SENDER_ID : "target lane", message: "hello" },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "dur-caller" } } as never,
  )
  expect(output.details.result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  return calls
}

describe("endpoint enumerations one thread_send starts (#12989)", () => {
  test("#given a send to an address no session published #when it runs inside one cache window and on a device where every step outlives the window #then it starts the counted enumerations", async () => {
    const counts = {
      first_frozen: await enumerationsForOneSend("frozen", "first"),
      first_spaced: await enumerationsForOneSend("spaced", "first"),
      reply_frozen: await enumerationsForOneSend("frozen", "reply"),
      reply_spaced: await enumerationsForOneSend("spaced", "reply"),
    }
    expect(counts).toEqual({ first_frozen: 1, first_spaced: 2, reply_frozen: 1, reply_spaced: 2 })
  })
})

describe("what one send to a thread on another device asks for, by path (#12989)", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)

  type Case = "first_by_name" | "first_by_id" | "reply_by_name" | "reply_by_id"

  async function callsForOneSend(path: Case): Promise<Record<string, number>> {
    const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "thread-enum-remote-")))
    cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }))
    const counts: Record<string, number> = {
      enumerations: 0,
      device_status: 0,
      device_list: 0,
      account_sessions: 0,
      alias_resolve: 0,
      session_commands: 0,
    }
    const bump = (key: string) => {
      counts[key] = (counts[key] ?? 0) + 1
    }
    const account = fixture.account()
    const base = account.remote
    const remote: RemoteThreadSurface = {
      ...base,
      sessions: {
        ...base.sessions,
        status: async () => (bump("device_status"), await base.sessions.status()),
        devices: async () => (bump("device_list"), await base.sessions.devices()),
        sessions: async () => (bump("account_sessions"), await base.sessions.sessions()),
        sessionCommand: async (device, session, rpc, options) => (
          bump("session_commands"),
          await base.sessions.sessionCommand(device, session, rpc, options)
        ),
      },
    }
    const host = createLiveThreadSurface(undefined, {
      env: { HOME: agentDir, OMO_CODING_AGENT_DIR: agentDir, SENPI_RPC_SOCKET: join(agentDir, "rpc.sock") },
      registry: async () => [],
      statusAll: async (): Promise<readonly HostEndpointReport[]> => (bump("enumerations"), []),
      now: () => 1_000,
    })
    const store = createGatewayStore({ agentDir })
    cleanups.push(() => store.dispose())
    const sender = { session_id: B_ROW.durable_id ?? "", name: B_ROW.title ?? "" }
    const reply = path === "reply_by_name" || path === "reply_by_id"
    const tools = createThreadTools({
      host,
      stateDirectory: agentDir,
      store,
      sessionsDirectory: () => join(agentDir, "sessions"),
      callerSessionId: () => "dur-caller",
      callerWorkspaceRoot: () => process.cwd(),
      remote,
      ...(reply ? { callerReplyTargets: () => [sender.session_id], callerReplySenders: () => [sender] } : {}),
    })
    const sendTool = tools.find((tool) => tool.name === "thread_send")
    if (sendTool === undefined) throw new Error("thread_send is not registered")
    const byId = path === "first_by_id" || path === "reply_by_id"
    const output = await sendTool.execute(
      "call-1",
      { thread: byId ? sender.session_id : sender.name, message: "hello" },
      undefined,
      undefined,
      { sessionManager: { getSessionId: () => "dur-caller" } } as never,
    )
    expect(output.details.result).toMatchObject({ kind: "ok", device: B_ROW.device })
    counts.alias_resolve = account.registryCalls.filter((call) => call === "resolve").length
    return counts
  }

  test("#given a thread on device b #when it is sent to first and replied to, by name and by durable id #then each path asks for the counted calls", async () => {
    const counts = {
      first_by_name: await callsForOneSend("first_by_name"),
      first_by_id: await callsForOneSend("first_by_id"),
      reply_by_name: await callsForOneSend("reply_by_name"),
      reply_by_id: await callsForOneSend("reply_by_id"),
    }
    // The fake registry counts a resolve for every address; the real client sends none for a session-id-shaped key
    // (remote/alias-registry.ts brokenRule), so on a device the by-id paths make one request fewer than the by-name ones.
    const each = {
      enumerations: 1,
      device_status: 1,
      device_list: 1,
      account_sessions: 1,
      alias_resolve: 1,
      session_commands: 2,
    }
    expect(counts).toEqual({ first_by_name: each, first_by_id: each, reply_by_name: each, reply_by_id: each })
  })
})
