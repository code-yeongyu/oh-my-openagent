import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AdapterFatal, type SurfaceAdapter } from "../adapter/contract"
import { FakeAdapter } from "../adapters/fake"
import { LineCollector } from "./fixtures/wait"
import { runConnectorHost, type ConnectorHostOptions } from "./host"
import { connectorsDir } from "./lock"
import { readConnectorStatus } from "./presence"
import type { ConnectorSink } from "./sink"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function agentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-host-fatal-"))
  roots.push(root)
  const dir = join(root, "agent")
  mkdirSync(connectorsDir(dir), { recursive: true, mode: 0o700 })
  return dir
}

class CollectingSink implements ConnectorSink {
  async emit(): Promise<void> {}
}

function options(dir: string, adapter: SurfaceAdapter, sink: ConnectorSink, signal: AbortSignal): ConnectorHostOptions {
  return { agentDir: dir, scope: "qa", platform: "slack", account_id: "T000TEST", createAdapter: () => adapter, sink, mode: "live", signal }
}

describe("connector host on AdapterFatal", () => {
  test("#given listen throws AdapterFatal #when two injected minutes pass #then it was tried once with no backoff and one notice, and a config change starts it again", async () => {
    // given
    const dir = agentDir()
    let clock = 0
    const controller = new AbortController()
    const delays: number[] = []
    const notices: string[] = []
    const parked = Promise.withResolvers<void>()
    const changed = Promise.withResolvers<boolean>()
    const relistening = Promise.withResolvers<void>()
    let refusedListens = 0
    const refused = new FakeAdapter()
    refused.listen = async () => {
      refusedListens += 1
      throw new AdapterFatal("slack", "invalid_auth", "slack auth.test: invalid_auth")
    }
    const healthy = new FakeAdapter()
    healthy.listen = async (_onEvent, signal, ready) => {
      ready()
      relistening.resolve()
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })))
    }
    const builds: SurfaceAdapter[] = [refused, healthy]
    let built = 0
    const running = runConnectorHost({
      ...options(dir, refused, new CollectingSink(), controller.signal),
      createAdapter: () => {
        built += 1
        return builds.shift() ?? healthy
      },
      now: () => new Date(clock),
      sleep: async (ms) => {
        delays.push(ms)
        clock += ms
        if (delays.length >= 5) controller.abort()
      },
      notice: (text) => notices.push(text),
      waitForChange: () => {
        parked.resolve()
        return changed.promise
      },
    })

    // when
    await Promise.race([parked.promise, running])
    clock += 120_000
    const stopped = await readConnectorStatus(dir, "slack", "T000TEST")
    const listensWhileStopped = refusedListens
    const delaysWhileStopped = [...delays]
    const noticesWhileStopped = [...notices]
    changed.resolve(true)
    await Promise.race([relistening.promise, running])
    controller.abort()
    const outcome = await running

    // then
    expect(listensWhileStopped).toBe(1)
    expect(delaysWhileStopped).toEqual([])
    expect(noticesWhileStopped).toHaveLength(1)
    expect(noticesWhileStopped[0]).toContain("slack auth.test: invalid_auth")
    expect(stopped.state === "alive" ? [stopped.presence?.state, stopped.presence?.last_error] : null).toEqual(["stopped", "fatal: invalid_auth"])
    expect(built).toBe(2)
    expect(notices).toHaveLength(1)
    expect(outcome.kind === "stopped" ? [outcome.restarts, outcome.fatal] : null).toEqual([1, null])
  })

  test("#given a stopped connector #when the host shuts down before any change #then it exits with the fatal reason and no retry", async () => {
    // given
    const dir = agentDir()
    const controller = new AbortController()
    const notices: string[] = []
    const delays: number[] = []
    const adapter = new FakeAdapter()
    adapter.listen = async () => {
      throw new AdapterFatal("telegram", "409", "telegram getUpdates failed (409): Conflict")
    }
    const logs = new LineCollector()

    // when
    const running = runConnectorHost({
      ...options(dir, adapter, new CollectingSink(), controller.signal),
      sleep: async (ms) => {
        delays.push(ms)
        if (delays.length >= 5) controller.abort()
      },
      notice: (text) => notices.push(text),
      log: (line) => logs.push(line),
    })
    await Promise.race([logs.waitFor((line) => line.startsWith("not restarting after telegram refused the account"), 1, "the fatal stop"), running])
    controller.abort()
    const outcome = await running

    // then
    expect(delays).toEqual([])
    expect(notices).toHaveLength(1)
    expect(outcome.kind === "stopped" ? outcome.fatal : null).toBe("409")
  })

  test("#given --once #when catch-up throws AdapterFatal #then one notice and the outcome names the fatal reason", async () => {
    // given
    const dir = agentDir()
    const notices: string[] = []
    const adapter = new FakeAdapter()
    adapter.catchUp = async function* () {
      yield* []
      throw new AdapterFatal("discord", "close 4004", "discord gateway closed with fatal code 4004; not reconnecting")
    }

    // when
    const outcome = await runConnectorHost({ ...options(dir, adapter, new CollectingSink(), new AbortController().signal), once: true, notice: (text) => notices.push(text) })

    // then
    expect(notices).toHaveLength(1)
    expect(outcome.kind === "stopped" ? outcome.fatal : null).toBe("close 4004")
  })

})
