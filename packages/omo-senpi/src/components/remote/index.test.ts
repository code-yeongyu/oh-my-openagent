import { describe, expect, test } from "bun:test"
import * as remote from "./index"

// The module's public barrel (package contract, design B2): the factories, the code list, the exit mapping and the seams
// are its only runtime values. createRemoteClient stays internal: a caller always builds its client through its sender's
// factory. resolveTypedDevice is seam 3 (#13432): the `omo remote` CLI may import only this barrel (G2,
// omo-native/test/remote-cli-imports.test.ts), so the one device resolver its session verbs use is public here.
// resolveTypedAddress is seam 4 (#14305): the same rule for the one thread-address resolver. personSurface and
// relayUnavailable are seam 5 (#13414 4c-2): the person client's surface that resolver reads, and the relay check.

describe("remote module barrel", () => {
  test("#given the barrel #when its runtime exports are listed #then they are exactly the public values", () => {
    expect(Object.keys(remote).sort()).toEqual([
      "LocalApiError",
      "REMOTE_CODES",
      "SESSION_ROW_STATES",
      "accountStateNotice",
      "canonicalizeThreadHandle",
      "classifyAccountShow",
      "connectLocalService",
      "describeThread",
      "deviceServiceEndpointPath",
      "deviceServiceStateDir",
      "exitCodeOf",
      "handleOf",
      "personSurface",
      "relayUnavailable",
      "remoteClient",
      "remoteClientForCli",
      "remoteClientForConnector",
      "remoteClientForPerson",
      "remoteClientForService",
      "remoteClientForSession",
      "remoteSessionsPort",
      "resolveTypedAddress",
      "resolveTypedDevice",
    ])
  })
})
