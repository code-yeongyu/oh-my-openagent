import type { RootCallKey } from "../contract"
import type { canaryRoot } from "./account-canaries.test-support"

// The account calls the non-disclosure scan drives (security design section 6), each with the root call it answers
// for, so a run under any principal can be held against that call's matrix cell.

type Sdk = Awaited<ReturnType<typeof canaryRoot>>["sdk"]
export type Run = {
  readonly name: string
  readonly key: RootCallKey
  readonly call: (sdk: Sdk) => Promise<unknown>
}

export const shownCodes: unknown[] = []
export const signIn = (method: "device_code" | "browser") => (sdk: Sdk) =>
  sdk.account.signIn({
    method,
    open_browser: false,
    onUserCode: (code: unknown) => {
      shownCodes.push(code)
    },
  })

export const RUNS: readonly Run[] = [
  { name: "whoami", key: "account.whoami", call: (sdk) => sdk.account.whoami() },
  { name: "show", key: "account.show", call: (sdk) => sdk.account.show({ account: "acct-1" }) },
  { name: "show, an empty account", key: "account.show", call: (sdk) => sdk.account.show({ account: "" }) },
  { name: "signInCheck", key: "account.signInCheck", call: (sdk) => sdk.account.signInCheck() },
  { name: "signIn while signed in", key: "account.signIn", call: signIn("device_code") },
  {
    name: "signIn after signing out",
    key: "account.signIn",
    call: async (sdk) => [await sdk.account.signOut(), await signIn("browser")(sdk)],
  },
  { name: "signOut", key: "account.signOut", call: (sdk) => sdk.account.signOut() },
  { name: "forget this device", key: "account.forget", call: (sdk) => sdk.account.forget({ device: "canary-device" }) },
  {
    name: "forget another device",
    key: "account.forget",
    call: (sdk) => sdk.account.forget({ device: "other-device" }),
  },
  { name: "store status", key: "account.store.status", call: (sdk) => sdk.account.store.status() },
  { name: "store enable", key: "account.store.enable", call: (sdk) => sdk.account.store.enable() },
  {
    name: "store disable after enable",
    key: "account.store.disable",
    call: async (sdk) => [await sdk.account.store.enable(), await sdk.account.store.disable()],
  },
  {
    name: "store disable with discard",
    key: "account.store.disable",
    call: async (sdk) => [await sdk.account.store.enable(), await sdk.account.store.disable({ discard: true })],
  },
]
