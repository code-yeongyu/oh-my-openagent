import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayEndpointRef, ReleaseSessionRequest } from "./gateway/adapter"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadSdk, type ThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

const TUI_SOCKET = "/tmp/t-0123456789abcdef.sock"
const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"

const directories: string[] = []
const sdks: ThreadSdk[] = []
afterEach(async () => {
  await Promise.all(sdks.splice(0).map((sdk) => sdk.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(options: { readonly release?: (endpoint: GatewayEndpointRef, request: ReleaseSessionRequest) => Promise<never> } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-sdk-"))
  directories.push(agentDir)
  const store: GatewayStore = createGatewayStore({ agentDir })
  const hostSession: ThreadHostSession = { sessionId: "rpc-1", durableSessionId: "dur-host", cwd: process.cwd(), name: "host lane", status: "open", socket: HOST_SOCKET, endpoint_kind: "rpc_host" }
  const tuiSession: ThreadHostSession = { sessionId: "dur-tui", durableSessionId: "dur-tui", cwd: process.cwd(), name: "my-tui", status: "open", socket: TUI_SOCKET, endpoint_kind: "tui" }
  const wakes: { readonly endpoint: GatewayEndpointRef; readonly ids: readonly string[] }[] = []
  const releases: { readonly endpoint: GatewayEndpointRef; readonly request: ReleaseSessionRequest }[] = []
  const unused = async (): Promise<never> => {
    throw new Error("not used by the SDK")
  }
  const host: ThreadHost = {
    socket: "/tmp/thread-sdk-legacy.sock",
    listSessions: async () => [hostSession, tuiSession],
    listView: async () => ({
      sessions: [hostSession, tuiSession],
      hosts: [
        { socket: HOST_SOCKET, list_sessions: { sessions: [hostSession] }, endpoint_kind: "rpc_host", alive: true },
        { socket: TUI_SOCKET, list_sessions: { sessions: [tuiSession] }, endpoint_kind: "tui", alive: true },
      ],
      disk: [],
    }),
    openSession: unused,
    getMessages: async () => [{ role: "user", content: "hello from the host" }],
    getState: async () => ({ isStreaming: false }),
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    gateway: {
      wake: async (endpoint, ids) => {
        wakes.push({ endpoint, ids })
        return { admitted: [] }
      },
      releaseSession: options.release ?? (async (endpoint, request) => {
        releases.push({ endpoint, request })
        return { success: true, data: { released: true, session_path: "/sessions/dur-host.jsonl", attachments: 0, dropped: { deliveries: ["d-1"], user_messages: ["queued ask"] } } }
      }),
    },
  }
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", host, store })
  sdks.push(sdk)
  return { sdk, store, wakes, releases }
}

describe("thread SDK: sessions", () => {
  test("#given a host and a terminal session #when listed and read #then rows carry surface and endpoint and the live transcript comes from the session's endpoint", async () => {
    const { sdk } = fixture()
    const listed = await sdk.list({})
    expect(listed).toMatchObject({ kind: "ok", scope: "workspace", threads: [{ thread_id: "dur-host", surface: "desktop", endpoint: { kind: "rpc_host", socket: HOST_SOCKET } }, { thread_id: "dur-tui", surface: "tui", endpoint: { kind: "tui" } }] })
    expect(await sdk.read({ thread: "host lane" })).toMatchObject({ kind: "ok", thread_id: "dur-host", items: [{ seq: 1, role: "user", content: JSON.stringify("hello from the host") }] })
  })

  test("#given no binding #when the CLI sends to the terminal #then the row is written by the cli principal with a cli origin and only a wake reaches the terminal", async () => {
    const { sdk, store, wakes } = fixture()
    const sent = await sdk.send({ thread: "my-tui", text: "ping" })
    expect(sent).toMatchObject({ kind: "ok", endpoint_kind: "tui", effective_mode: "auto", deduplicated: false })
    const rows = await store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => ({ sender: row.sender, origin: row.envelope.origin, actor: row.envelope.actor }))).toEqual([
      { sender: "cli:501", origin: { external: { platform: "cli", account_id: "qa-user", chat_id: "@cli", thread_id: "@chat", message_id: rows[0]?.delivery_id ?? "" } }, actor: "qa-user" },
    ])
    expect(wakes.map((wake) => wake.endpoint.kind)).toEqual(["tui"])
    expect(sdk.principal).toBe("cli:501")
  })

  test("#given a send without target or binding #when called #then it is invalid_arguments and nothing is written", async () => {
    const { sdk, store } = fixture()
    expect(await sdk.send({ text: "nowhere" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(await store.list()).toEqual([])
  })
})

describe("thread SDK: bindings and the connector surface", () => {
  test("#given a binding #when the same inbound event is sent twice through it #then the binding principal writes it once in the binding's mode", async () => {
    const { sdk, store } = fixture()
    const bound = await sdk.bind({ session: "my-tui", binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", inbound_mode: "follow_up" } })
    expect(bound).toMatchObject({ kind: "ok", binding: { session_durable_id: "dur-tui", revision: 1 } })
    const bindingId = (bound as { binding: { binding_id: string } }).binding.binding_id
    const first = await sdk.send({ binding_id: bindingId, text: "hello from outside", idempotency_key: "evt-1" })
    const second = await sdk.send({ binding_id: bindingId, text: "hello from outside", idempotency_key: "evt-1" })
    expect(first).toMatchObject({ kind: "ok", effective_mode: "follow_up", deduplicated: false })
    expect(second).toMatchObject({ kind: "ok", deduplicated: true })
    const rows = await store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => row.sender)).toEqual([`binding:${bindingId}`])
  })

  test("#given a binding of one session #when a send names another session as its target #then it is refused and nothing is written", async () => {
    const { sdk, store } = fixture()
    const bound = await sdk.bind({ session: "my-tui", binding: { platform: "custom", account_id: "qa", chat_id: "c1" } })
    const bindingId = (bound as { binding: { binding_id: string } }).binding.binding_id
    expect(await sdk.send({ thread: "host lane", binding_id: bindingId, text: "wrong target" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments", details: { session: "dur-tui" } } })
    expect(await store.list()).toEqual([])
  })

  test("#given a milestone in the outbox #when a connector reads, acks and re-reads #then the ack moves the cursor and an older cursor still re-reads the row", async () => {
    const { sdk } = fixture()
    const bound = await sdk.bind({ session: "dur-tui", binding: { platform: "custom", account_id: "qa", chat_id: "c1" } })
    const bindingId = (bound as { binding: { binding_id: string } }).binding.binding_id
    const reported = await sdk.report({ session: "my-tui", binding_id: bindingId, kind: "milestone", text: "done step 1" })
    expect(reported).toMatchObject({ kind: "ok", binding_id: bindingId, event: "milestone" })
    const cursor = (reported as { cursor: number }).cursor
    expect(await sdk.outbox({ binding_id: bindingId })).toMatchObject({ kind: "ok", rows: [{ cursor, text: "done step 1" }] })
    expect(await sdk.ack({ binding_id: bindingId, cursor, provider_message_id: "m-1" })).toEqual({ kind: "ok", binding_id: bindingId, acked_cursor: cursor, changed: true })
    expect(await sdk.outbox({ binding_id: bindingId })).toMatchObject({ kind: "ok", rows: [] })
    expect(await sdk.outbox({ binding_id: bindingId, after_cursor: cursor - 1 })).toMatchObject({ kind: "ok", rows: [{ cursor }] })
  })

  test("#given a question asked through binding X #when the answer arrives through binding Y #then it is binding_mismatch and the question stays pending", async () => {
    const { sdk } = fixture()
    const x = await sdk.bind({ session: "my-tui", binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "x" } })
    const y = await sdk.bind({ session: "my-tui", binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "y" } })
    const xId = (x as { binding: { binding_id: string } }).binding.binding_id
    const yId = (y as { binding: { binding_id: string } }).binding.binding_id
    const asked = await sdk.report({ session: "my-tui", binding_id: xId, kind: "question", text: "proceed?", request_id: "ui-1" })
    const token = (asked as { reply_token: string }).reply_token
    expect(await sdk.answer({ binding_id: yId, reply_token: token, answer: "yes" })).toMatchObject({ kind: "error", error: { code: "binding_mismatch" } })
    expect(await sdk.outbox({ binding_id: xId })).toMatchObject({ rows: [{ event: "question", question_state: "pending" }] })
  })
})

describe("thread SDK: takeover", () => {
  test("#given a host session #when located and released #then the release carries reason takeover and the flags on the serving endpoint", async () => {
    const { sdk, releases } = fixture()
    const located = await sdk.locate({ thread: "host lane" })
    expect(located).toMatchObject({ kind: "ok", thread: { thread_id: "dur-host", surface: "desktop", alive: true, endpoint: { kind: "rpc_host", socket: HOST_SOCKET, routing_id: "rpc-1" } } })
    if (located.kind !== "ok") throw new Error("located")
    expect(await sdk.release(located.thread, { interrupt: true })).toMatchObject({ success: true, data: { session_path: "/sessions/dur-host.jsonl" } })
    expect(releases).toEqual([{ endpoint: { kind: "rpc_host", socket: HOST_SOCKET, routing_id: "rpc-1" }, request: { reason: "takeover", interrupt: true } }])
  })

  test("#given an endpoint that fails in transport #when released #then the failure is data, never a throw", async () => {
    const { sdk } = fixture({ release: async () => { throw new Error(`host_unavailable:${HOST_SOCKET}`) } })
    const located = await sdk.locate({ thread: "dur-host" })
    if (located.kind !== "ok") throw new Error("located")
    expect(await sdk.release(located.thread, {})).toMatchObject({ success: false, error: "host_unavailable" })
  })
})
