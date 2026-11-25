import { describe, expect, test } from "bun:test"

import { CANARIES, canaryRoot, FAULTS, type Fault, USER_CODE } from "./account-canaries.test-support"
import { leaked } from "./account-canary-scan.test-support"
import { RUNS } from "./account-non-disclosure.runs.test-support"

// Security contract (security design section 6, slice A1b): one injected fault of each class an account call meets
// (the service refusing or failing with a canary in its body, a revoke left unconfirmed, the store locked, unavailable
// or unreadable with a canary in its error's own words, the keychain helper refusing with one in its reply) leaves no
// canary in any answer, log line or custody record of any account call.

describe("the account calls on the root disclose no planted secret under an injected fault (#14945 section 6)", () => {
  for (const fault of FAULTS.filter((name) => name !== "none"))
    for (const run of RUNS)
      test(`#given ${fault} and ${run.name} #then no canary leaves`, async () => {
        const { sdk, logs, custodyRecords } = await canaryRoot(fault)
        const answer = await run.call(sdk).catch((error: unknown) => error)
        const records = await custodyRecords()
        expect(leaked([answer, logs, records])).toEqual([])
        expect(leaked([answer, logs, records], { userCode: USER_CODE })).toEqual([])
      })

  // A fault the scan injects must reach the call it is run under, or the run proves nothing about that call. These are
  // the runs a store fault cannot reach, each for its own reason: signInCheck touches no store; an empty account is
  // refused before any read; store status reads only the dedicated store's state; the store switch reads the sign-in
  // through the keychain helper, which helper_refuses and the locked login keychain (store_locked) cover.
  const BEHIND_THE_HELPER = ["store enable", "store disable after enable", "store disable with discard"]
  const NO_STORE_READ = ["show, an empty account", "signInCheck", "store status"]
  const UNREACHED: Readonly<Record<string, readonly string[]>> = {
    store_locked: NO_STORE_READ,
    store_unavailable: [...NO_STORE_READ, ...BEHIND_THE_HELPER],
    store_unreadable: [...NO_STORE_READ, ...BEHIND_THE_HELPER],
  }
  const comparable = (value: unknown) => JSON.stringify(value, (key, field) => (key === "api" ? "" : field))
  for (const [fault, unreached] of Object.entries(UNREACHED))
    test(`#given ${fault} #then it changes the answer of every run but those it cannot reach`, async () => {
      const same: string[] = []
      for (const run of RUNS) {
        const clean = await run.call((await canaryRoot("none")).sdk).catch((error: unknown) => String(error))
        const faulted = await run.call((await canaryRoot(fault as Fault)).sdk).catch((error: unknown) => String(error))
        if (comparable(clean) === comparable(faulted)) same.push(run.name)
      }
      expect(same).toEqual([...unreached])
    })

  test("#given the keychain helper refusing #then the store switch answers its own words with the store named", async () => {
    const { sdk } = await canaryRoot("helper_refuses")
    expect(await sdk.account.store.enable()).toMatchObject({
      kind: "error",
      error: { code: "credential_store_unavailable", details: { reason: "switch_failed" } },
    })
  })

  test("#given a revoke the service leaves unconfirmed #then the custody record says partial and holds no canary", async () => {
    const { sdk, custodyRecords } = await canaryRoot("revoke_unconfirmed")
    expect(await sdk.account.signOut()).toMatchObject({ kind: "ok", value: { revoked: false } })
    const records = await custodyRecords()
    expect(records).toContain('"outcome":"partial"')
    expect(leaked([records], CANARIES)).toEqual([])
  })
})
