import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createGatewayStore } from "./gateway/store"
import type { ThreadHost } from "./tools"

// Q's steer-all order (omo#14972) on the root: a parked session is woken by the root's threads.send as by `omo thread
// send` (sdk.test.ts, the same fake), because the root's thread core is the facade's core (design lane ruling on P1b).
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const unused = async (): Promise<never> => {
  throw new Error("not used by a send")
}
const nothingAnswering: ThreadHost = {
  socket: "/tmp/root-wake-legacy.sock",
  listSessions: async () => [],
  listView: async (request) => {
    if (request?.offline !== true) throw new Error("connect ECONNREFUSED")
    return { sessions: [], hosts: [], disk: [] }
  },
  openSession: unused,
  getMessages: unused,
  getState: unused,
  prompt: unused,
  interrupt: unused,
  setSessionName: unused,
  setModel: unused,
  getAvailableModels: unused,
  setThinkingLevel: unused,
  getAvailableThinkingLevels: unused,
  gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
}

describe("the root's threads.send to a parked session", () => {
  test("#given a parked interactive thread #when the root's threads.send names it #then a wake is requested for it", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "root-wake-"))
    const sessions = join(agentDir, "sessions", "--fixture--")
    mkdirSync(sessions, { recursive: true })
    writeFileSync(
      join(sessions, "epoch_dur-parked.jsonl"),
      `${JSON.stringify({ type: "session", id: "dur-parked", cwd: process.cwd(), timestamp: "2026-10-02T00:00:00Z" })}\n`,
    )
    const store = createGatewayStore({ agentDir })
    const root = assembleOmoSdk(
      { agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", ports: { host: nothingAnswering, store } },
      {},
    )
    cleanups.push(async () => {
      await root.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    })

    const sent = await root.threads.send({ thread: "dur-parked", message: "wake up" })

    expect(sent.kind).toBe("ok")
    expect((await store.woken.list()).map((row) => ({ durable_id: row.durable_id, state: row.state }))).toEqual([
      { durable_id: "dur-parked", state: "requested" },
    ])
  })
})
