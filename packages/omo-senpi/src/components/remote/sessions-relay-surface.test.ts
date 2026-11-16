import { afterEach, describe, expect, test } from "bun:test"
import { PEER } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { clientOn, closeClients, fakeClock, startOwner } from "./testing/fake-service"

// The session members run the thread tools' own bodies on a relay surface, and those bodies read the account through the
// surface's client (#13414 U5). The surface must carry the client it lives in: without it, the open's online check of
// the target device cannot read the device list and answers host_unavailable before anything reaches that device.

afterEach(closeClients)

describe("the session members' relay surface carries its own client", () => {
  test("#given a peer device that is online #when a session is opened on it #then the open passes the online check and reaches that device, never failing to read the device list", async () => {
    const owner = await startOwner()
    const client = clientOn(owner.stateDir, fakeClock())
    const opened = await client.sessions.open({ device: PEER, cwd: "/work/omo" })
    if (opened.kind === "error") expect(opened.message).not.toContain("could not list the account's devices")
    expect(owner.state.commands.some((rpc) => rpc["type"] === "open_session")).toBe(true)
  })
})
