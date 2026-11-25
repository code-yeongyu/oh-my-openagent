import { describe, expect, test } from "bun:test"

import { CANARIES, canaryRoot, FAULTS, USER_CODE } from "./account-canaries.test-support"
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
