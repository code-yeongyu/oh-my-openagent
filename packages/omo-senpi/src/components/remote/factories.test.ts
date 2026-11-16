import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteClient } from "./client"
import {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForService,
  remoteClientForSession,
} from "./factories"
import { closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"

// The factories fix who a client acts as and which client version (the hello's `version` field) it hands the device service; the conformance
// owner records each connection's hello, so the version is read where the service sees it.

const clients: RemoteClient[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await closeClients()
})
const kept = (client: RemoteClient): RemoteClient => {
  clients.push(client)
  return client
}

describe("remote client factories", () => {
  test("#given a person client #when it reaches the service #then its hello carries the caller's version and it may change the service", async () => {
    const owner = await startOwner()
    const client = kept(remoteClientForPerson({ version: "5.1.74", stateDir: owner.stateDir, timers: fakeClock() }))

    const enabled = await client.service.setEnabled(false)

    expect(enabled).toEqual({ kind: "ok", value: { enabled: false } })
    expect([...owner.state.conns].map((conn) => conn.client())).toEqual([{ name: "omo", version: "5.1.74" }])
  })

  test("#given no version #then a factory does not compile (the module reads no default, so it pulls no product config)", () => {
    // @ts-expect-error the version is required: a default would drag the telemetry config graph into every caller
    const build = () => remoteClientForPerson({ stateDir: "/nonexistent-rt-13414" })
    expect(typeof build).toBe("function")
  })

  test("#given session, connector and cli clients #when each calls a person-only member #then each answers sender_not_allowed", async () => {
    const owner = await startOwner()
    const deps = { version: "5.1.74", stateDir: owner.stateDir, timers: fakeClock() }
    const built = [
      remoteClientForSession("dur-1", deps),
      remoteClientForConnector("binding-1", deps),
      remoteClientForCli("501", deps),
    ].map(kept)

    for (const client of built)
      expect(failureOf(await client.service.setEnabled(false)).code).toBe("sender_not_allowed")
    expect(await kept(remoteClientForPerson(deps)).service.status()).toMatchObject({ value: { enabled: true } })
  })

  test("#given an explicit version #when the client reaches the service #then the hello carries that version", async () => {
    const owner = await startOwner()
    const client = kept(
      remoteClientForSession("dur-1", { version: "9.9.9", stateDir: owner.stateDir, timers: fakeClock() }),
    )

    expect((await client.service.info()).kind).toBe("ok")
    expect([...owner.state.conns].map((conn) => conn.client()?.version)).toEqual(["9.9.9"])
  })
})

describe("remoteClientForService", () => {
  test("#given the device service's own client #when it calls bootstrap and a person-only mutator #then bootstrap is allowed and the mutator is refused", async () => {
    const client = kept(remoteClientForService({ version: "5.1.74", stateDir: "/nonexistent-rt-13414" }))
    // No bootstrap runner was handed in, so the call reaches the runner check (allowed sender), not the sender check.
    const bootstrap = await client.service.bootstrap({})
    expect(bootstrap).toMatchObject({ kind: "error", code: "unsupported", details: { feature: "bootstrap" } })
    expect(await client.service.setEnabled(true)).toMatchObject({ kind: "error", code: "sender_not_allowed" })
  })
})
