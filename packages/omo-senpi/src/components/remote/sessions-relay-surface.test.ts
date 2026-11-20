import { afterEach, describe, expect, test } from "bun:test"
import { PEER } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { clientOn, closeClients, fakeClock, startOwner } from "./testing/fake-service"

// The session members run the thread tools' own bodies on a relay surface, and those bodies read the account through the
// surface's client (#13414 U5). Without its client, the open's online check of the target device cannot read the device
// list, so the open ends host_unavailable here before anything is sent to that device.

afterEach(closeClients)

describe("the session members' relay surface carries its own client", () => {
  test("#given a peer device that is online #when a session is opened on it #then the open passes the online check and its answer comes from that device", async () => {
    const owner = await startOwner()
    const client = clientOn(owner.stateDir, fakeClock())
    const opened = await client.sessions.open({ device: PEER, workspace: "/work/omo" })
    // Whatever the peer answers (the fake owner refuses an endpoint open), the open got past the online check, which needs
    // the device list read through the surface's client: without it the open ends host_unavailable before the peer.
    if (opened.kind === "error") expect(opened.code).not.toBe("host_unavailable")
  })
})
