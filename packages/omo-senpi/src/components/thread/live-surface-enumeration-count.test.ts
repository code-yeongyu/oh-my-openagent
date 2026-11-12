// #12989: how many endpoint enumerations (`host status --all`, one cold engine CLI process each) one thread_send starts.
// The count is taken twice: with a frozen clock (every step inside one cache window) and with every clock read more than
// a cache window after the previous one (a loaded device, where each step outlives the window).
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface, HOST_ENDPOINTS_CACHE_TTL_MS, type HostEndpointReport } from "./live-surface"
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
  writeFileSync(join(dir, `2026-11-12T10-00-00-000Z_${id}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`)
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
