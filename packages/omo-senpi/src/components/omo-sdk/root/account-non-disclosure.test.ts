import { describe, expect, test } from "bun:test"

import type { OmoPrincipal, RootCallKey } from "../contract"
import { boundaryRefusals } from "./authority"
import { CANARIES, canaryRoot, USER_CODE } from "./account-canaries.test-support"
import { leaked } from "./account-canary-scan.test-support"
import { RUNS, shownCodes, signIn } from "./account-non-disclosure.runs.test-support"

// Security contract (security design section 6, slice A1b): a canary planted in the fake store, the fake keychain or
// the fake account service's answers reaches no answer, failure (message, stack, cause, details), log line or custody
// record of any account call on the root, under every principal; and each answer is the one the principal's matrix
// cell gives. The user code is the one secret with a destination: onUserCode, and only there.

// The security owner's ruling on review 6065026586, independent of the matrix: a connector and a service are refused
// the account reads (design 4.2), so a matrix without their cells cannot make this scan agree with it.
const ACCOUNT_READS = new Set<RootCallKey>(["account.whoami", "account.show", "account.signInCheck"])

const PRINCIPALS: readonly OmoPrincipal[] = [
  { kind: "person", uid: 501 },
  { kind: "script", uid: 501 },
  { kind: "session", session_id: "01-session" },
  { kind: "connector", binding: "binding-1" },
  { kind: "service" },
]

describe("the account calls on the root disclose no planted secret, under every principal (#14945 section 6)", () => {
  for (const principal of PRINCIPALS)
    for (const run of RUNS)
      test(`#given a ${principal.kind} and ${run.name} #then no canary leaves and the answer is the matrix cell's`, async () => {
        const { sdk, logs, custodyRecords } = await canaryRoot("none", principal)
        const answer = (await run.call(sdk)) as { readonly kind?: string; readonly error?: { readonly code?: string } }
        const records = await custodyRecords()
        expect(leaked([answer, logs, records])).toEqual([])
        expect(leaked([answer, logs, records], { userCode: USER_CODE })).toEqual([])
        const refusal = boundaryRefusals(principal, {}).get(run.key)
        const last = Array.isArray(answer) ? answer.at(-1) : answer
        if (ACCOUNT_READS.has(run.key) && (principal.kind === "connector" || principal.kind === "service"))
          expect(last).toMatchObject({ kind: "error", error: { code: "sender_not_allowed" } })
        if (refusal === undefined) expect(last?.error?.code).not.toBe("sender_not_allowed")
        else expect(last).toMatchObject({ kind: "error", error: { code: refusal.code } })
      })

  test("#given forget then signOut on the root #then each writes its started and terminal pair, attributed to the root's principal", async () => {
    const { sdk, custodyRecords } = await canaryRoot()
    await sdk.account.forget({ device: "other-device" })
    await sdk.account.signOut()
    const records = (await custodyRecords())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(records.map((record) => [record.capability, record.phase, record.outcome ?? null])).toEqual([
      ["account.forget", "started", null],
      ["account.forget", "terminal", "refused"],
      ["account.signOut", "started", null],
      ["account.signOut", "terminal", "ok"],
    ])
    expect(new Set(records.map((record) => record.principal.id))).toEqual(new Set(["501"]))
  })

  test("#given a fresh device-code sign-in #then only the user code leaves, and only through onUserCode", async () => {
    const { sdk, logs } = await canaryRoot()
    await sdk.account.signOut()
    shownCodes.length = 0
    const answer = await signIn("device_code")(sdk)
    expect(answer).toMatchObject({ kind: "ok", value: { device_service: "on" } })
    expect(leaked([answer, logs])).toEqual([])
    expect(leaked([answer, logs], { userCode: USER_CODE })).toEqual([])
    expect(leaked([shownCodes])).toEqual([])
    expect(leaked([shownCodes], { userCode: USER_CODE })).toEqual(["userCode"])
  })
})

describe("the scan's negative controls", () => {
  const encoded = Buffer.from(CANARIES.refreshToken)
  test.each([
    ["a value field", { kind: "ok", value: { nested: { token: CANARIES.accessToken } } }],
    ["a failure message", { kind: "error", error: { message: `refused ${CANARIES.refreshToken}` } }],
    ["a failure's details", { kind: "error", error: { details: { raw: [CANARIES.signingPrivateKey] } } }],
    ["an error's stack and cause", new Error("wrapped", { cause: new Error(CANARIES.deviceCode) })],
    ["a log line", [`refresh ${CANARIES.offlineGrant}`]],
    ["the keychain value in an answer", { kind: "ok", value: { moved: CANARIES.keychainValue } }],
    ["a Map", new Map([["token", CANARIES.accessToken]])],
    ["a Set", new Set([CANARIES.sealingPrivateKey])],
    ["a Uint8Array", new Uint8Array(encoded)],
    ["a Buffer", Buffer.from(CANARIES.offlineGrant)],
    ["a symbol key", { [Symbol(CANARIES.accessToken)]: true }],
    ["a symbol-keyed value", { [Symbol("hidden")]: CANARIES.refreshToken }],
    ["a base64 copy", { value: encoded.toString("base64") }],
    ["a base64url copy", { value: encoded.toString("base64url") }],
    ["a hex copy", { value: encoded.toString("hex") }],
    ["a 16-character prefix", { value: CANARIES.accessToken.slice(0, 16) }],
  ])("#given a canary planted in %s #then the scan names it", (_where, surface) => {
    expect(leaked([surface])).not.toEqual([])
  })
})
