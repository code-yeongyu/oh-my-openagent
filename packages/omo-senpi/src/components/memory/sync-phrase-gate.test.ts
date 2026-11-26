import { afterEach, expect, test } from "bun:test"

import type { AccountHttp } from "@oh-my-opencode/memory-core/sync-engine"

import { enableSync } from "../../../../memory-core/src/sync/account/enable"
import { createAccountHttp } from "../../../../memory-core/src/sync/account/http"
import { ACCOUNT, fixture } from "../../../../memory-core/src/sync/account/testing/genesis-enable.test-support"
import {
  phraseGenesis,
  scriptedSurface,
} from "../../../../memory-core/src/sync/account/testing/phrase-enable.test-support"
import { PHRASE_GENESIS_FLAG, phraseGateFrom } from "./sync-phrase-gate"

const logger = () => {
  const lines: { message: string; fields?: Record<string, unknown> }[] = []
  return {
    lines,
    error: (message: string, fields?: Record<string, unknown>) =>
      void lines.push({ message, ...(fields === undefined ? {} : { fields }) }),
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

type Fixture = Awaited<ReturnType<typeof fixture>>

/**
 * A phrase genesis through the real engine and the real account HTTP client, with the host's own gate. The floor is
 * whatever the wire server's `GET /v1/sync/state` answers for the operation's signed-in chain; `stateFrom` swaps
 * only that route's client to model a signed-out session or an unreachable service.
 */
const phraseEnable = async (
  env: Readonly<Record<string, string | undefined>>,
  acceptsPhraseKeys: boolean | undefined,
  stateFrom?: (f: Fixture) => AccountHttp["state"],
) => {
  const f = await fixture(acceptsPhraseKeys === undefined ? {} : { acceptsPhraseKeys })
  cleanups.push(f.close)
  const log = logger()
  const person = scriptedSurface()
  let stateReads = 0
  const state = stateFrom?.(f) ?? f.input.chain.state
  const { method: _passkey, ...base } = f.input
  const result = await enableSync({
    ...base,
    chain: {
      ...base.chain,
      state: (operation) => {
        stateReads += 1
        return state(operation)
      },
    },
    method: "phrase",
    phraseGate: phraseGateFrom(env, log),
    genesis: {
      prfSupported: false,
      phraseSupported: true,
      createGenesis: f.input.genesis.createGenesis,
      createPhraseGenesis: phraseGenesis(person.surface),
    },
  })
  return { result, log, f, shown: person.calls.show, stateReads }
}

const FLAG_ON = { [PHRASE_GENESIS_FLAG]: "1" }

test("#given the release flag on and the signed-in state route answering accepts_phrase_keys true #when a phrase genesis is asked for through the host gate #then it is created", async () => {
  const s = await phraseEnable(FLAG_ON, true)
  expect(s.result).toEqual({ kind: "joined", created: true })
  expect(s.log.lines).toEqual([])
  expect(s.stateReads).toBeGreaterThan(0)
})

for (const [label, accepts, stateFrom] of [
  ["answering accepts_phrase_keys false", false, undefined],
  ["leaving accepts_phrase_keys out (an older service)", undefined, undefined],
  [
    "refusing a signed-out session (401)",
    true,
    (f: Fixture) => createAccountHttp({ baseUrl: f.options.baseUrl, token: () => "signed-out" }).state,
  ],
  [
    "unreachable (a read error)",
    true,
    (f: Fixture) => createAccountHttp({ baseUrl: "http://127.0.0.1:1", token: f.options.token }).state,
  ],
] as const) {
  test(`#given the release flag on and the state route ${label} #when a phrase genesis is asked for through the host gate #then it is refused as service-floor-off, logged, with no words shown and nothing written`, async () => {
    const s = await phraseEnable(FLAG_ON, accepts, stateFrom)
    expect(s.result).toEqual({ kind: "phrase_unavailable", reason: "service-floor-off" })
    expect(s.log.lines).toEqual([
      {
        message: "memory sync refused to create a recovery phrase",
        fields: { reason: "service-floor-off", account: ACCOUNT, flag: PHRASE_GENESIS_FLAG },
      },
    ])
    expect(s.shown).toBe(0)
    expect(s.f.entries).toEqual([])
    expect(s.f.server.switches).toEqual([])
  })
}

for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
  test(`#given the release flag ${value === undefined ? "absent" : JSON.stringify(value)} and a service that accepts phrase keys #when a phrase genesis is asked for through the host gate #then it is refused as disabled without reading the floor`, async () => {
    const s = await phraseEnable(value === undefined ? {} : { [PHRASE_GENESIS_FLAG]: value }, true)
    expect(s.result).toEqual({ kind: "phrase_unavailable", reason: "disabled" })
    expect(s.stateReads).toBe(0)
    expect(s.log.lines).toEqual([])
    expect(s.f.entries).toEqual([])
  })
}

test("#given a refused phrase creation #when the gate reports it #then one error line names the reason, the account and the flag, and nothing secret", () => {
  const log = logger()
  phraseGateFrom(FLAG_ON, log).refused("service-floor-off", "account-1")
  expect(log.lines).toEqual([
    {
      message: "memory sync refused to create a recovery phrase",
      fields: { reason: "service-floor-off", account: "account-1", flag: PHRASE_GENESIS_FLAG },
    },
  ])
})
