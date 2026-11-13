import { afterEach, expect, test } from "bun:test"
import { enableSync } from "./enable.ts"
import { fixture } from "./testing/genesis-enable.test-support.ts"
import { openGate, phraseGenesis, scriptedSurface } from "./testing/phrase-enable.test-support.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

// Protocol contract (A1.1-M3, agreed with omo-service): every sync request memory-core makes, account and
// pairing routes alike, says it parses phrase keys with `omo-sync-capabilities: phrase` and carries
// `omo-contract-version: 1.44.0`. The service floor reads the capability; an absent header is not capable.
test("#given a phrase genesis over the account and pairing routes #when the service records each request #then every one carries the capability and contract-version headers", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  const { method: _passkey, ...base } = f.input
  const result = await enableSync({
    ...base,
    method: "phrase",
    phraseGate: openGate(),
    genesis: {
      prfSupported: false,
      phraseSupported: true,
      createGenesis: f.input.genesis.createGenesis,
      createPhraseGenesis: phraseGenesis(scriptedSurface().surface),
    },
  })
  expect(result).toEqual({ kind: "joined", created: true })
  const seen = f.server.syncHeaders
  expect(new Set(seen.map((row) => row.path))).toEqual(
    new Set([
      "/v1/sync/keys",
      "/v1/sync/state",
      "/v1/sync/entries",
      "/v1/account/sync",
      "/v1/devices/service-first/sync",
    ]),
  )
  expect(seen.filter((row) => row.capabilities !== "phrase" || row.version !== "1.44.0")).toEqual([])
})
