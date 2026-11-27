// #15221 "Key order is part of the contract": a caller that reads the first characters of a send's answer (a cut tool
// line, a truncated CLI --json line) reads its delivery state, not the start of a link. Q 2026-11-27: a send that waited
// in the target's queue was taken for sent, because the answer's text put `delivery` after the thread and its link.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGatewayStore } from "../gateway/store"
import { createThreadSdk, type ThreadSdk } from "../sdk"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import type { ThreadHost } from "../tools"
import type { RemoteCommandOutcome } from "../remote/ports"

const { account, surface, cleanup } = createRemoteThreadFixture()
const sdks: ThreadSdk[] = []
const directories: string[] = []
afterEach(async () => {
  await cleanup()
  await Promise.all(sdks.splice(0).map((sdk) => sdk.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const answers = (kind: string): RemoteCommandOutcome => ({
  kind: "ok",
  response: {
    type: "response",
    id: null,
    command: "admit_external_message",
    success: true,
    data: { kind, turnId: "3" },
  },
})

const HEAD = 40

describe("a send's answer leads with its delivery state", () => {
  test.each(["held", "queued"])(
    "#given device b's engine answers %s #when thread_send delivers there #then the tool text names delivery queued within its first 40 characters",
    async (engineAnswer) => {
      const a = account({ admitOutcome: answers(engineAnswer) })
      const { run } = surface(a.remote)
      // `output()` serializes exactly this object into the text the model reads.
      const text = JSON.stringify(
        await run("thread_send", { thread: B_ROW.durable_id, message: "hi", all_scope: true }),
      )
      expect(text.slice(0, HEAD)).toContain('"delivery":{"kind":"queued"')
      expect(text).toStartWith('{"kind":"ok","delivery":')
    },
  )

  test("#given a terminal no engine drains #when omo thread send answers #then its --json line names delivery within its first 40 characters", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "send-order-"))
    directories.push(agentDir)
    const tui = {
      sessionId: "dur-tui",
      durableSessionId: "dur-tui",
      cwd: process.cwd(),
      name: "my-tui",
      status: "open",
      socket: "/tmp/t-0123456789abcdef.sock",
      endpoint_kind: "tui",
    } as const
    const host = {
      socket: "/tmp/send-order-legacy.sock",
      listSessions: async () => [tui],
      listView: async () => ({
        sessions: [tui],
        hosts: [{ socket: tui.socket, list_sessions: { sessions: [tui] }, endpoint_kind: "tui", alive: true }],
        disk: [],
      }),
      gateway: { wake: async () => ({ admitted: [] }) },
    } as unknown as ThreadHost
    const sdk = createThreadSdk({
      agentDir,
      cwd: process.cwd(),
      uid: 501,
      user: "qa-user",
      host,
      store: createGatewayStore({ agentDir }),
      firstPromptWaitMs: 0,
    })
    sdks.push(sdk)
    // omo-native bin/lib/thread.js prints this object with JSON.stringify and nothing else.
    const line = JSON.stringify(await sdk.send({ thread: "my-tui", text: "ping" }))
    expect(line.slice(0, HEAD)).toContain('"delivery":{"kind":"queued')
    expect(line).toStartWith('{"kind":"ok","delivery":')
  })
})
