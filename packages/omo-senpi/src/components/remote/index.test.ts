import { describe, expect, test } from "bun:test"
import * as remote from "./index"

// The module's public barrel (package contract): the factories, the client constructor, the code list and the exit
// mapping are its only runtime values; types are checked by the typecheck.

describe("remote module barrel", () => {
  test("#given the barrel #when its runtime exports are listed #then they are exactly the public values", () => {
    expect(Object.keys(remote).sort()).toEqual([
      "REMOTE_CODES",
      "createRemoteClient",
      "exitCodeOf",
      "remoteClientForCli",
      "remoteClientForConnector",
      "remoteClientForPerson",
      "remoteClientForSession",
    ])
  })
})
