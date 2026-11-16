import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { RemoteClient } from "./client"
import {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForService,
  remoteClientForSession,
} from "./factories"
import { closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"

// The factories fix who a client acts as and which omo version it hands the device service in its hello; the conformance
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

const packageVersion = (): string => {
  const version: unknown = Reflect.get(
    JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")),
    "version",
  )
  if (typeof version !== "string") throw new Error("omo-senpi's package.json names a version")
  return version
}

describe("remote client factories", () => {
  test("#given a person client built without a version #when it reaches the service #then its hello carries the omo-senpi package version and it may change the service", async () => {
    const owner = await startOwner()
    const client = kept(remoteClientForPerson({ stateDir: owner.stateDir, timers: fakeClock() }))

    const enabled = await client.service.setEnabled(false)

    expect(enabled).toEqual({ kind: "ok", value: { enabled: false } })
    expect([...owner.state.conns].map((conn) => conn.client())).toEqual([{ name: "omo", version: packageVersion() }])
  })

  test("#given session, connector and cli clients #when each calls a person-only member #then each answers sender_not_allowed", async () => {
    const owner = await startOwner()
    const deps = { stateDir: owner.stateDir, timers: fakeClock() }
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
    const client = kept(remoteClientForService({ stateDir: "/nonexistent-rt-13414" }))
    // No bootstrap runner was handed in, so the call reaches the runner check (allowed sender), not the sender check.
    const bootstrap = await client.service.bootstrap({})
    expect(bootstrap).toMatchObject({ kind: "error", code: "unsupported", details: { feature: "bootstrap" } })
    expect(await client.service.setEnabled(true)).toMatchObject({ kind: "error", code: "sender_not_allowed" })
  })
})
