import { describe, expect, test } from "bun:test"
import * as remote from "./index"

// The module's public barrel (package contract, design B2): the factories, the code list, the exit mapping and the seams
// are its only runtime values. createRemoteClient stays internal: a caller always builds its client through its sender's
// factory. resolveTypedDevice is seam 3 (#13432): the `omo remote` CLI may import only this barrel (G2,
// omo-native/test/remote-cli-imports.test.ts), so the one device resolver its session verbs use is public here.

describe("remote module barrel", () => {
  test("#given the barrel #when its runtime exports are listed #then they are exactly the public values", () => {
    expect(Object.keys(remote).sort()).toEqual([
      "REMOTE_CODES",
      "canonicalizeThreadHandle",
      "describeThread",
      "exitCodeOf",
      "handleOf",
      "remoteClientForCli",
      "remoteClientForConnector",
      "remoteClientForPerson",
      "remoteClientForService",
      "remoteClientForSession",
      "resolveTypedDevice",
    ])
  })
})
