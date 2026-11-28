import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { gatewayDatabasePath } from "./gateway/paths"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadSdk, type ThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

// omo#15187: a seat taken over while its old session is parked hands the old session's pending deliveries on (move) or
// drops them (cancel), through the SDK, without loading that session.

const BUSY_SOCKET = "/tmp/t-15187busy0000000.sock"
const directories: string[] = []
const sdks: ThreadSdk[] = []
afterEach(async () => {
  await Promise.all(sdks.splice(0).map((sdk) => sdk.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function seats(files: Readonly<Record<string, string>>, live: readonly ThreadHostSession[] = []) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-backlog-"))
  directories.push(agentDir)
  const sessionsDir = join(agentDir, "sessions", "--fixture--")
  mkdirSync(sessionsDir, { recursive: true })
  for (const [id, name] of Object.entries(files))
    writeFileSync(
      join(sessionsDir, `epoch_${id}.jsonl`),
      [
        { type: "session", id, cwd: process.cwd(), timestamp: "2026-11-27T00:00:00Z" },
        { type: "session_info", name, timestamp: "2026-11-27T00:00:01Z" },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    )
  const unused = async (): Promise<never> => {
    throw new Error("not used by the backlog call")
  }
  const host: ThreadHost = {
    socket: "/tmp/thread-backlog-legacy.sock",
    listSessions: async () => [...live],
    listView: async () => ({
      sessions: live,
      hosts: live.map((session) => ({
        socket: session.socket ?? BUSY_SOCKET,
        list_sessions: { sessions: [session] },
        endpoint_kind: "tui" as const,
        alive: true as const,
      })),
      disk: [],
    }),
    openSession: unused,
    getMessages: unused,
    getState: async () => ({ isStreaming: true }),
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
  }
  const store: GatewayStore = createGatewayStore({ agentDir })
  const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", host, store })
  sdks.push(sdk)
  return { agentDir, sdk, store }
}

async function queue(sdk: ThreadSdk, thread: string, texts: readonly string[]): Promise<string[]> {
  const ids: string[] = []
  for (const [index, text] of texts.entries()) {
    const sent = await sdk.send({ thread, text, idempotency_key: `${thread}-k${index}` })
    if (sent.kind !== "ok" || sent.delivery_id === undefined)
      throw new Error(`seeding ${thread} failed: ${JSON.stringify(sent)}`)
    ids.push(sent.delivery_id)
  }
  return ids
}

async function queued(store: GatewayStore, thread: string) {
  return (await store.list({ target_durable_id: thread }))
    .filter((row) => row.state === "queued")
    .sort((left, right) => left.seq - right.seq)
    .map((row) => ({ id: row.delivery_id, sender: row.sender, body: row.body }))
}

describe("thread SDK backlog: cancel or move the pending deliveries of an unloaded session (#15187)", () => {
  test("#given a parked seat with 3 pending deliveries #when the new holder of its name moves them to itself #then the source holds 0 and the destination the same 3 in order, sender and idempotency key kept", async () => {
    const { agentDir, sdk, store } = seats({ "dur-old": "lead", "dur-new": "lead" })
    const ids = await queue(sdk, "dur-old", ["m1", "m2", "m3"])

    const moved = await sdk.backlog({
      thread: "dur-old",
      caller: "dur-new",
      action: "move",
      destination: "dur-new",
      idempotency_key: "takeover-1",
    })

    expect(moved).toMatchObject({ kind: "ok", thread: "dur-old", action: "move", destination: "dur-new" })
    if (moved.kind !== "ok" || moved.action !== "move") throw new Error(`move failed: ${JSON.stringify(moved)}`)
    const pairs = moved.moved
    expect(pairs.map((pair) => pair.delivery_id)).toEqual(ids)
    expect(await queued(store, "dur-old")).toEqual([])
    const landed = await queued(store, "dur-new")
    expect(landed).toEqual(
      pairs.map((pair, index) => ({ id: pair.new_delivery_id, sender: "cli:501", body: `m${index + 1}` })),
    )
    // Each send's idempotency key now names its moved line, so the sender's retry finds the line where it went.
    const db = new Database(gatewayDatabasePath(agentDir), { readonly: true })
    try {
      const keyed = db
        .query("SELECT idempotency_key, delivery_id FROM receipts WHERE operation = 'deliver' ORDER BY idempotency_key")
        .all()
      expect(keyed).toEqual(
        pairs.map((pair, index) => ({ idempotency_key: `dur-old-k${index}`, delivery_id: pair.new_delivery_id })),
      )
    } finally {
      db.close()
    }

    const again = await sdk.backlog({
      thread: "dur-old",
      caller: "dur-new",
      action: "move",
      destination: "dur-new",
      idempotency_key: "takeover-1",
    })
    expect(again).toEqual({ ...moved, deduplicated: true } as typeof again)
    expect(await queued(store, "dur-new")).toEqual(landed)
  })

  test("#given a parked seat with pending deliveries #when a session that neither holds its name nor created it asks #then it is refused as data and nothing changes", async () => {
    const { sdk, store } = seats({ "dur-old": "lead", "dur-other": "other" })
    await queue(sdk, "dur-old", ["m1", "m2"])
    const before = await queued(store, "dur-old")

    const refused = await sdk.backlog({
      thread: "dur-old",
      caller: "dur-other",
      action: "move",
      destination: "dur-other",
      idempotency_key: "intruder-1",
    })

    expect(refused).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(await queued(store, "dur-old")).toEqual(before)
    expect(await queued(store, "dur-other")).toEqual([])
  })

  test("#given a parked seat its lead created #when the lead cancels its backlog #then the cancelled ids come back and the seat holds nothing pending", async () => {
    const { sdk, store } = seats({ "dur-old": "lead", "dur-boss": "boss" })
    const ids = await queue(sdk, "dur-old", ["m1", "m2"])
    await store.recordThreadCreation({ creator_durable_id: "dur-boss", created_durable_id: "dur-old" })

    const cancelled = await sdk.backlog({
      thread: "dur-old",
      caller: "dur-boss",
      action: "cancel",
      idempotency_key: "cancel-1",
    })

    expect(cancelled).toEqual({ kind: "ok", thread: "dur-old", action: "cancel", cancelled: ids, deduplicated: false })
    expect(await queued(store, "dur-old")).toEqual([])
  })

  test("#given the seat's old session is loaded and mid-turn #when its new holder moves the backlog #then turn_active is answered and nothing changes", async () => {
    const busy: ThreadHostSession = {
      sessionId: "dur-busy",
      durableSessionId: "dur-busy",
      cwd: process.cwd(),
      name: "busy",
      status: "open",
      activity: "running",
      socket: BUSY_SOCKET,
      endpoint_kind: "tui",
    }
    const { sdk, store } = seats({ "dur-busy": "busy", "dur-busy-new": "busy" }, [busy])
    await queue(sdk, "dur-busy", ["m1", "m2"])
    const before = await queued(store, "dur-busy")
    expect(before).toHaveLength(2)

    const refused = await sdk.backlog({
      thread: "dur-busy",
      caller: "dur-busy-new",
      action: "move",
      destination: "dur-busy-new",
      idempotency_key: "busy-1",
    })

    expect(refused).toMatchObject({ kind: "error", error: { code: "turn_active" } })
    expect(await queued(store, "dur-busy")).toEqual(before)
    expect(await queued(store, "dur-busy-new")).toEqual([])
  })
})
