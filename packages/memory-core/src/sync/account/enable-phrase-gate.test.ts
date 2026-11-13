import { afterEach, expect, test } from "bun:test"
import { readServiceFloor, type ServiceFloor } from "../genesis/phrase-gate.ts"
import { enableSync } from "./enable.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"
import { phraseGenesis, phraseMarkerExists, scriptedGate, scriptedSurface } from "./testing/phrase-enable.test-support.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

// Amendment A1 (prod launched): phrase key creation is behind a client flag that is off by default, and
// with the flag on it still needs the service floor to be positively on. Every refusal writes nothing.
const setup = async (enabled: boolean | undefined, floor: ServiceFloor) => {
  const f = await fixture()
  cleanups.push(f.close)
  const person = scriptedSurface()
  const scripted = scriptedGate(enabled === true, floor)
  const { method: _passkey, ...base } = f.input
  const input = {
    ...base,
    ...(enabled === undefined ? {} : { phraseGate: scripted.gate }),
    genesis: { prfSupported: false, phraseSupported: true, createGenesis: f.input.genesis.createGenesis, createPhraseGenesis: phraseGenesis(person.surface) },
  }
  const untouched = async () => {
    expect(f.server.switches).toEqual([])
    expect(f.entries).toEqual([])
    expect(person.calls.show).toBe(0)
    expect(await phraseMarkerExists(f.input.pinDir, f.keyring.principal().id)).toBe(false)
  }
  return { input, refusals: scripted.refusals, untouched }
}

for (const enabled of [undefined, false] as const) {
  test(`#given the phrase flag ${enabled === undefined ? "absent" : "off"} #when a first device enables #then phrase is never offered and a phrase genesis is refused as disabled with nothing written`, async () => {
    const s = await setup(enabled, "on")
    expect(await enableSync(s.input)).toEqual({ kind: "method_required", methods: [] })
    expect(await enableSync({ ...s.input, method: "phrase" })).toEqual({ kind: "phrase_unavailable", reason: "disabled" })
    await s.untouched()
    expect(s.refusals).toEqual([])
  })
}

for (const floor of ["off", "unknown"] as const) {
  test(`#given the phrase flag on and the service floor ${floor} #when a phrase genesis is asked for #then it is refused as service-floor-off, logged loudly with the account, and nothing is written`, async () => {
    const s = await setup(true, floor)
    expect(await enableSync(s.input)).toEqual({ kind: "method_required", methods: ["phrase"] })
    expect(await enableSync({ ...s.input, method: "phrase" })).toEqual({
      kind: "phrase_unavailable",
      reason: "service-floor-off",
    })
    expect(s.refusals).toEqual([{ reason: "service-floor-off", account: ACCOUNT }])
    await s.untouched()
  })
}

test("#given the phrase flag on and the service floor on #when a phrase genesis is asked for #then it proceeds", async () => {
  const s = await setup(true, "on")
  expect(await enableSync({ ...s.input, method: "phrase" })).toEqual({ kind: "joined", created: true })
  expect(s.refusals).toEqual([])
})

// The engine reads the floor from the operation's own signed-in state route (omo-service #1070
// `phrase_client_floor`): only a literal true admits a phrase genesis; false, absent or an error refuse.
for (const [label, floor, outcome] of [
  ["true", true, "created"],
  ["false", false, "refused"],
  ["absent", undefined, "refused"],
  ["a request error", "error", "refused"],
] as const) {
  test(`#given the phrase flag on and phrase_client_floor ${label} on the state route #when a phrase genesis is asked for #then it is ${outcome}`, async () => {
    const f = await fixture(typeof floor === "boolean" ? { phraseClientFloor: floor } : {})
    cleanups.push(f.close)
    const refusals: string[] = []
    const { method: _passkey, ...base } = f.input
    const chain =
      floor === "error"
        ? { ...base.chain, state: async () => Promise.reject(new Error("synthetic state failure")) }
        : base.chain
    const input = {
      ...base,
      chain,
      phraseGate: { enabled: true, serviceFloor: readServiceFloor, refused: (reason: string) => void refusals.push(reason) },
      genesis: { prfSupported: false, phraseSupported: true, createGenesis: f.input.genesis.createGenesis, createPhraseGenesis: phraseGenesis(scriptedSurface().surface) },
    }
    const result = await enableSync({ ...input, method: "phrase" })
    if (outcome === "created") {
      expect(result).toEqual({ kind: "joined", created: true })
      expect(refusals).toEqual([])
    } else {
      expect(result).toEqual({ kind: "phrase_unavailable", reason: "service-floor-off" })
      expect(refusals).toEqual(["service-floor-off"])
      expect(f.server.switches).toEqual([])
      expect(f.entries).toEqual([])
    }
  })
}

// A1.1-M4: every way the floor port can fail refuses exactly like "unknown", before any marker, words or onCeremony.
for (const [label, serviceFloor] of [
  ["throws", (): Promise<ServiceFloor> => {
    throw new Error("synthetic port throw")
  }],
  ["rejects", async (): Promise<ServiceFloor> => Promise.reject(new Error("synthetic port rejection"))],
  ["never answers (timeout)", (): Promise<ServiceFloor> => new Promise<ServiceFloor>(() => undefined)],
  ["answers a value outside the protocol", async (): Promise<ServiceFloor> => JSON.parse('"maybe"')],
] as const) {
  test(`#given the phrase flag on and a floor port that ${label} #when a phrase genesis is asked for #then it refuses as service-floor-off with the log line, no marker and no ceremony`, async () => {
    const s = await setup(true, "on")
    const refusals: string[] = []
    const ceremonies: string[] = []
    const phraseGate = { enabled: true, serviceFloor, floorTimeoutMs: 25, refused: (reason: string) => void refusals.push(reason) }
    expect(
      await enableSync({ ...s.input, phraseGate, method: "phrase", onCeremony: (method) => void ceremonies.push(method) }),
    ).toEqual({ kind: "phrase_unavailable", reason: "service-floor-off" })
    expect(refusals).toEqual(["service-floor-off"])
    expect(ceremonies).toEqual([])
    await s.untouched()
  })
}

test("#given a host gate with no floor port (the production default until the A1 delta is CLEAR) #when the service reports the floor on #then phrase genesis is still refused", async () => {
  const f = await fixture({ phraseClientFloor: true })
  cleanups.push(f.close)
  const refusals: string[] = []
  const { method: _passkey, ...base } = f.input
  const result = await enableSync({
    ...base,
    method: "phrase",
    phraseGate: { enabled: true, refused: (reason: string) => void refusals.push(reason) },
    genesis: { prfSupported: false, phraseSupported: true, createGenesis: f.input.genesis.createGenesis, createPhraseGenesis: phraseGenesis(scriptedSurface().surface) },
  })
  expect(result).toEqual({ kind: "phrase_unavailable", reason: "service-floor-off" })
  expect(refusals).toEqual(["service-floor-off"])
  expect(f.entries).toEqual([])
})
