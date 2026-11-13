import { afterEach, expect, test } from "bun:test"
import type { PhraseGate } from "@oh-my-opencode/memory-core/sync-engine"
import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"

afterEach(disposeSyncRpcFixtures)

const gate = (enabled: boolean): PhraseGate => ({ enabled, serviceFloor: async () => "on", refused: () => undefined })

test("#given the phrase flag off or on #when features is asked #then phrase-genesis is listed only while the flag is on (amendment A1)", async () => {
  const off = await setup({ phraseGate: gate(false) })
  expect(await off.call("features", owner("a").context)).toEqual({ features: ["enable-method", "acknowledge"] })
  const absent = await setup()
  expect(await absent.call("features", owner("a").context)).toEqual({ features: ["enable-method", "acknowledge"] })
  const on = await setup({ phraseGate: gate(true) })
  expect(await on.call("features", owner("a").context)).toEqual({
    features: ["enable-method", "phrase-genesis", "acknowledge"],
  })
})

test("#given enable with the phrase method #when the ceremony starts #then the method and gate reach enable, the call answers in_progress at once, and status settles to the created outcome", async () => {
  const phraseGate = gate(true)
  const f = await setup({ phraseGate })
  const finish = Promise.withResolvers<void>()
  const seen: { method?: string; gate?: PhraseGate }[] = []
  f.runtime.enableSync = async (input) => {
    seen.push({ ...(input.method !== undefined && { method: input.method }), ...(input.phraseGate !== undefined && { gate: input.phraseGate }) })
    input.onCeremony?.("phrase")
    await finish.promise
    return { kind: "joined", created: true }
  }
  const a = owner("a")
  expect(await f.call("enable", a.context, { method: "phrase" })).toEqual({ kind: "in_progress", method: "phrase" })
  expect(seen).toEqual([{ method: "phrase", gate: phraseGate }])
  expect(await f.call("status", a.context)).toMatchObject({ enable: { kind: "in_progress", method: "phrase" } })
  finish.resolve()
  await f.coordinator.dispose()
})

test("#given an enable request with an unknown field #when it arrives #then it is refused before any account work", async () => {
  const f = await setup()
  expect(await f.call("enable", owner("a").context, { method: "phrase", words: "x" })).toEqual({
    kind: "refused",
    reason: "Invalid enable request.",
  })
  expect(f.counts().begins).toBe(0)
})

test("#given a void phrase notice, another process's ceremony, or an unreadable notice #when status is read #then the notice, an in_progress enable, or phraseUnresolved is reported", async () => {
  const f = await setup()
  const a = owner("a")
  f.runtime.phraseNoticeStatus = async () => ({ phraseVoid: { purpose: "genesis" } })
  expect(await f.call("status", a.context)).toMatchObject({ enable: null, phraseVoid: { purpose: "genesis" } })
  f.runtime.phraseNoticeStatus = async () => ({ inProgress: true })
  expect(await f.call("status", a.context)).toMatchObject({ enable: { kind: "in_progress" } })
  f.runtime.phraseNoticeStatus = async () => {
    throw new Error("unreadable")
  }
  expect(await f.call("status", a.context)).toMatchObject({ phraseUnresolved: true })
})

test("#given an acknowledge request #when it arrives #then only the named notice reaches the runtime, a malformed one is refused, and an unwired host answers unavailable", async () => {
  const f = await setup()
  const a = owner("a")
  expect(await f.call("acknowledge", a.context, { notice: "phrase_void", purpose: "genesis" })).toMatchObject({
    kind: "unavailable",
  })
  const seen: { purpose: string; credentialId?: string }[] = []
  f.runtime.acknowledgePhraseVoid = async (input) => {
    seen.push({ purpose: input.purpose, ...(input.credentialId !== undefined && { credentialId: input.credentialId }) })
    return { ok: true }
  }
  expect(await f.call("acknowledge", a.context, { notice: "phrase_void", purpose: "rotate", credentialId: "c1" })).toEqual({
    ok: true,
  })
  expect(seen).toEqual([{ purpose: "rotate", credentialId: "c1" }])
  expect(await f.call("acknowledge", a.context, { notice: "other", purpose: "genesis" })).toEqual({
    kind: "refused",
    reason: "Invalid acknowledge request.",
  })
})

test("#given the engine refuses phrase creation with a reason #when enable answers over RPC #then the reason reaches the wire", async () => {
  const f = await setup()
  f.runtime.enableSync = async () => ({ kind: "phrase_unavailable", reason: "service-floor-off" })
  expect(await f.call("enable", owner("a").context, { method: "phrase" })).toEqual({
    kind: "phrase_unavailable",
    reason: "service-floor-off",
  })
})

test("#given an unresolved local phrase read and a verified-chain reader #when status is read #then the enroll void notice from the verified chain is shown", async () => {
  const f = await setup()
  const seen: string[] = []
  f.runtime.phraseNoticeStatus = async () => ({ phraseUnresolved: true })
  f.runtime.verifiedPhraseNoticeStatus = async (input) => {
    seen.push(input.account)
    return { phraseVoid: { purpose: "enroll" } }
  }
  const status = await f.call("status", owner("a").context)
  expect(status).toMatchObject({ phraseVoid: { purpose: "enroll" } })
  expect(status).not.toHaveProperty("phraseUnresolved")
  expect(seen.length).toBe(1)
})
