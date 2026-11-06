import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bounded } from "../../lifecycle/__fixtures__/live-parent-fakes"
import { childSpec, ensuredDaemon } from "../rpc-host.test-support"
import { manualRecoveryClock } from "./__fixtures__/manual-recovery-clock"
import type { ChildEndpointPorts } from "./child-endpoint"
import { createHostSessionHandle } from "./handle"
import { fakeSessionPort, FAKE_SESSION, type FakeSessionPort } from "./handle.test-support"
import type { HostSessionReattached, HostSessionReattachRefused } from "./reattach"
import { createReattachPort } from "./reattach-port"
import type { OpenedHostSession } from "./session-client"

/**
 * omo#10925: once a lost transport's recovery bound runs out, the child parks and live-parent
 * recovery owns its session (it respawns it, or closes it on the host when the budget runs out).
 * The reattach the bound abandoned must not start another attempt when its stalled open finally
 * fails: on Windows that failure arrives after the give-up closed the session, and the retry
 * reopened the closed session on the host, with a fresh process.
 */

const SOCKET = "/tmp/dh-10925/rpc.sock"

function transportGone(): Error {
  return Object.assign(new Error("connection closed"), { code: "rpc_transport_gone" })
}

function endpointPorts(
  root: string,
  ensureDaemon: ChildEndpointPorts["ensureDaemon"] = () => Promise.resolve(ensuredDaemon(SOCKET)),
): ChildEndpointPorts {
  return {
    agentDir: join(root, "agent"),
    env: {},
    policy: "upgrade",
    ensureDaemon,
    storeDir: join(root, "store"),
    shardResolver: () => {
      throw new Error("a reattach opens its recorded socket and never resolves a shard")
    },
    ownHostSocket: () => undefined,
    insideHost: () => false,
    probeHost: () => Promise.resolve(undefined),
    notice: () => undefined,
    now: () => 0,
  }
}

describe("a reattach abandoned by its recovery bound", () => {
  test("#given the bound ran out and the child parked #when the stalled reopen fails afterwards #then no further reopen is attempted", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "dh-10925-"))
    const clock = manualRecoveryClock()
    const original = fakeSessionPort()
    const stalledOpen = Promise.withResolvers<OpenedHostSession>()
    const firstOpenAsked = Promise.withResolvers<void>()
    const clients: FakeSessionPort[] = []
    let opens = 0
    const port = createReattachPort({
      endpoint: endpointPorts(root),
      spec: childSpec({ task_id: "st_10925" }),
      delaysMs: [0, 0],
      sleep: () => Promise.resolve(),
      createClient: () => {
        const client = fakeSessionPort()
        clients.push(client)
        return client
      },
      open: () => {
        opens += 1
        if (opens === 1) {
          firstOpenAsked.resolve()
          return stalledOpen.promise
        }
        return Promise.resolve({ sessionId: "routing-3", attached: false, instanceId: "inst-1", engineVersion: "2026.9.18" })
      },
    })
    const attempts: Array<Promise<HostSessionReattached | HostSessionReattachRefused | undefined>> = []
    const handle = createHostSessionHandle({
      client: original, session: FAKE_SESSION, taskId: "st_10925",
      heartbeatIntervalMs: 60_000, now: () => 0, closeGraceMs: 0, openDisposition: "attached",
      transportRecovery: { clock },
      // Pass-through: the suite only keeps the attempt so it can await its end.
      reattach: (lost, abandoned) => {
        const attempt = port(lost, abandoned)
        attempts.push(attempt)
        return attempt
      },
    })
    const parked = Promise.withResolvers<string>()
    handle.onParked((event) => parked.resolve(event.reason))
    try {
      await handle.startInitialPrompt("start a long-running process")
      original.loseTransport()
      await bounded(firstOpenAsked.promise)
      clock.expire()
      expect(await bounded(parked.promise)).toBe("daemon_unavailable")

      // when - the Windows order: the stalled reopen's socket drops only after the give-up
      stalledOpen.reject(transportGone())
      const [attempt] = attempts
      if (attempt === undefined) throw new Error("the handle never asked to reattach")
      const answer = await bounded(attempt)

      // then
      expect(answer).toBeUndefined()
      expect(opens).toBe(1)
      expect(clients).toHaveLength(1)
    } finally {
      await handle.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
  test("#given a reopen still ensuring its endpoint #when the bound runs out and the endpoint answers afterwards #then the session is never opened", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "dh-10925-"))
    const clock = manualRecoveryClock()
    const original = fakeSessionPort()
    const ensured = Promise.withResolvers<ReturnType<typeof ensuredDaemon>>()
    const ensureAsked = Promise.withResolvers<void>()
    let opens = 0
    const port = createReattachPort({
      endpoint: endpointPorts(root, () => {
        ensureAsked.resolve()
        return ensured.promise
      }),
      spec: childSpec({ task_id: "st_10925_ensure" }),
      delaysMs: [0],
      sleep: () => Promise.resolve(),
      createClient: () => fakeSessionPort(),
      open: () => {
        opens += 1
        return Promise.resolve({ sessionId: "routing-3", attached: false, instanceId: "inst-1", engineVersion: "2026.9.18" })
      },
    })
    const attempts: Array<Promise<HostSessionReattached | HostSessionReattachRefused | undefined>> = []
    const handle = createHostSessionHandle({
      client: original, session: FAKE_SESSION, taskId: "st_10925_ensure",
      heartbeatIntervalMs: 60_000, now: () => 0, closeGraceMs: 0, openDisposition: "attached",
      transportRecovery: { clock },
      // Pass-through: the suite only keeps the attempt so it can await its end.
      reattach: (lost, abandoned) => {
        const attempt = port(lost, abandoned)
        attempts.push(attempt)
        return attempt
      },
    })
    const parked = Promise.withResolvers<string>()
    handle.onParked((event) => parked.resolve(event.reason))
    try {
      await handle.startInitialPrompt("start a long-running process")
      original.loseTransport()
      await bounded(ensureAsked.promise)
      clock.expire()
      expect(await bounded(parked.promise)).toBe("daemon_unavailable")

      // when - the endpoint answers only after the give-up
      ensured.resolve(ensuredDaemon(SOCKET))
      const [attempt] = attempts
      if (attempt === undefined) throw new Error("the handle never asked to reattach")
      const answer = await bounded(attempt)

      // then
      expect(answer).toBeUndefined()
      expect(opens).toBe(0)
    } finally {
      await handle.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
