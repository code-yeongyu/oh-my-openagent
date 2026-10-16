import { afterEach, describe, expect, test } from "bun:test"

import { HostSessionClient } from "./session-client"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"
import { createSenpiRpcClient } from "./session-transport"

const harness = sessionClientHarness()
afterEach(harness.release)

async function observedWithin(signal: Promise<void>): Promise<boolean> {
  const deadline = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => deadline.resolve(false), 1_000)
  try {
    return await Promise.race([signal.then(() => true), deadline.promise])
  } finally {
    clearTimeout(timer)
  }
}

describe("HostSessionClient connection lifetime", () => {
  for (const ending of ["park", "close"] as const) {
    test(`#given an attached task session #when the host sends ${ending} #then public client occupancy returns to baseline`, async () => {
      // given
      const host = await harness.fakeHost()
      const baseline = host.connections
      const client = harness.hostClient(host)
      const path = `/tmp/sessions/lifetime-${ending}.jsonl`
      const opened = await client.open(childOpenInput(path))
      await host.waitForConnections(baseline + 1)
      const released = host.waitForConnections(baseline)

      // when
      if (ending === "park") host.evict(path)
      else host.closeSession(opened.sessionId, "host_shutdown")

      // then
      const returnedToBaseline = await observedWithin(released)
      expect(host.connections).toBe(baseline)
      expect(returnedToBaseline).toBe(true)
      expect(client.sessionId).toBeUndefined()
    })
  }

  test("#given two sessions sharing a host with one mid-attach #when the other closes #then the survivor stays connected and attaches", async () => {
    // given
    const host = await harness.fakeHost()
    const first = harness.hostClient(host)
    const opened = await first.open(childOpenInput("/tmp/sessions/lifetime-first.jsonl"))
    const attaching = Promise.withResolvers<void>()
    const continueAttach = Promise.withResolvers<void>()
    const survivor = new HostSessionClient({
      socketPath: host.socketPath,
      ports: {
        probeProtocolInfo: () => host.probeProtocolInfo(),
        createClient: async (options) => {
          const client = await createSenpiRpcClient(options)
          const open = client.openSession.bind(client)
          client.openSession = async (input) => {
            attaching.resolve()
            await continueAttach.promise
            return open(input)
          }
          return client
        },
      },
    })
    const pending = survivor.open(childOpenInput("/tmp/sessions/lifetime-survivor.jsonl"))
    try {
      await attaching.promise
      await host.waitForConnections(2)
      const firstReleased = host.waitForConnections(1)

      // when
      host.closeSession(opened.sessionId, "host_shutdown")

      // then
      const firstDisconnected = await observedWithin(firstReleased)
      expect(host.connections).toBe(1)
      expect(firstDisconnected).toBe(true)
      continueAttach.resolve()
      const attached = await pending
      expect(survivor.sessionId).toBe(attached.sessionId)
      expect((await survivor.getState()).sessionId).toBe(`durable-${attached.sessionId}`)
      expect(host.connections).toBe(1)
    } finally {
      continueAttach.resolve()
      await pending
      await survivor.detach()
    }
  })

  test("#given a retained session parked by the host #when another client reopens its path #then it remains revivable", async () => {
    // given
    const host = await harness.fakeHost()
    const first = harness.hostClient(host)
    const path = "/tmp/sessions/lifetime-revival.jsonl"
    await first.open(childOpenInput(path))
    const released = host.waitForConnections(0)
    host.evict(path)
    expect(await observedWithin(released)).toBe(true)

    // when
    const revived = harness.hostClient(host)
    const opened = await revived.open(childOpenInput(path))

    // then
    expect(revived.sessionId).toBe(opened.sessionId)
    expect(host.connections).toBe(1)
    expect(host.commands.filter((command) => command.type === "close_session")).toHaveLength(0)
  })

  test("#given a host refusing close_session #when close fails #then the client still releases its public connection", async () => {
    // given
    const host = await harness.fakeHost()
    const client = harness.hostClient(host)
    await client.open(childOpenInput("/tmp/sessions/lifetime-refused-close.jsonl"))
    await host.waitForConnections(1)
    host.failReply("close_session", "host_draining")
    const released = host.waitForConnections(0)

    // when
    const refusal = await client.close().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(Error)
    expect(String(refusal)).toContain("host_draining")

    // then
    const disconnected = await observedWithin(released)
    expect(host.connections).toBe(0)
    expect(disconnected).toBe(true)
  })
})
