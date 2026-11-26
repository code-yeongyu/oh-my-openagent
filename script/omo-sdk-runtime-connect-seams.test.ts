import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { findRawTlsClients } from "./no-raw-tls-client"

// Security owner's ruling on #14950 (TLS guard): the shipped SDK runtimes carry no raw TLS client hit of any rule, with
// no allowlist entry. Their injected `connect` seams are read by destructuring with a node:net local-socket default, so no
// `<name>.connect` member read reaches the bundle, where the name-keyed scanner would read it as Bun.connect. A seam
// written later as a member read fails here, in the slice that adds it.
const REPO_ROOT = join(import.meta.dir, "..")
const RUNTIMES = [
  "packages/omo-senpi/plugin/runtime/omo-sdk/sdk.js",
  "packages/omo-senpi/plugin/runtime/thread-sdk/sdk.js",
]

describe("the shipped SDK runtimes' raw TLS client hits", () => {
  for (const runtime of RUNTIMES)
    test(`#given ${runtime} #then the scanner finds no raw TLS client in it`, () => {
      expect(findRawTlsClients(readFileSync(join(REPO_ROOT, runtime), "utf8"), runtime)).toEqual([])
    })
})
