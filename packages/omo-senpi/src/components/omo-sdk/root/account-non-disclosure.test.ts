import { describe, expect, test } from "bun:test"

import { CANARIES, canaryRoot, leaked, USER_CODE } from "./account-canaries.test-support"

// Security contract (security design section 6, slice A1b): a canary planted in the fake store, the fake keychain or
// the fake account service's answers reaches no answer, failure (message, stack, cause, details) or log line of any
// account call on the root, on its ok path, its refusals and one injected fault each. The user code is the one secret
// with a destination: onUserCode, and only there.

type Sdk = Awaited<ReturnType<typeof canaryRoot>>["sdk"]
type Run = {
  readonly name: string
  readonly fault?: "unauthorized" | "denied"
  readonly call: (sdk: Sdk) => Promise<unknown>
}

const shownCodes: unknown[] = []
const signIn = (method: "device_code" | "browser") => (sdk: Sdk) =>
  sdk.account.signIn({
    method,
    open_browser: false,
    onUserCode: (code: unknown) => {
      shownCodes.push(code)
    },
  })

const RUNS: readonly Run[] = [
  { name: "whoami", call: (sdk) => sdk.account.whoami() },
  { name: "whoami, the service refuses the session", fault: "unauthorized", call: (sdk) => sdk.account.whoami() },
  { name: "show", call: (sdk) => sdk.account.show({ account: "acct-1" }) },
  { name: "show, an empty account", call: (sdk) => sdk.account.show({ account: "" }) },
  { name: "signInCheck", call: (sdk) => sdk.account.signInCheck() },
  { name: "signIn, this machine is already signed in", call: signIn("device_code") },
  { name: "signOut", call: (sdk) => sdk.account.signOut() },
  { name: "forget this device", call: (sdk) => sdk.account.forget({ device: "canary-device" }) },
  { name: "forget another device", call: (sdk) => sdk.account.forget({ device: "other-device" }) },
  {
    name: "store enable then disable",
    call: async (sdk) => [await sdk.account.store.enable(), await sdk.account.store.disable()],
  },
  {
    name: "store disable with discard, refused",
    call: async (sdk) => [await sdk.account.store.enable(), await sdk.account.store.disable({ discard: true })],
  },
  { name: "store status", call: (sdk) => sdk.account.store.status() },
]

describe("the account calls on the root disclose no planted secret (#14945 section 6, #14364)", () => {
  for (const run of RUNS)
    test(`#given ${run.name} #then its answers, logs and custody records hold no canary`, async () => {
      const { sdk, logs, custodyRecords } = await canaryRoot(run.fault)
      const answer = await run.call(sdk)
      const records = await custodyRecords()
      expect(leaked([answer, logs, records])).toEqual([])
      expect(leaked([answer, logs, records], { userCode: USER_CODE })).toEqual([])
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

  test("#given a denied sign-in #then the refusal holds no canary and the code went only to onUserCode", async () => {
    const { sdk, logs } = await canaryRoot("denied")
    await sdk.account.signOut()
    shownCodes.length = 0
    const answer = await signIn("browser")(sdk)
    expect(answer).toMatchObject({ kind: "error", error: { code: "approval_denied" } })
    expect(leaked([answer, logs], { ...CANARIES, userCode: USER_CODE })).toEqual([])
    expect(leaked([shownCodes], { userCode: USER_CODE })).toEqual(["userCode"])
  })
})

describe("the scan's negative controls", () => {
  test.each([
    ["a value field", { kind: "ok", value: { nested: { token: CANARIES.accessToken } } }],
    ["a failure message", { kind: "error", error: { message: `refused ${CANARIES.refreshToken}` } }],
    ["a failure's details", { kind: "error", error: { details: { raw: [CANARIES.signingPrivateKey] } } }],
    ["an error's stack and cause", new Error("wrapped", { cause: new Error(CANARIES.deviceCode) })],
    ["a log line", [`refresh ${CANARIES.offlineGrant}`]],
    ["the keychain value in an answer", { kind: "ok", value: { moved: CANARIES.keychainValue } }],
  ])("#given a canary planted in %s #then the scan names it", (_where, surface) => {
    expect(leaked([surface])).not.toEqual([])
  })
})
