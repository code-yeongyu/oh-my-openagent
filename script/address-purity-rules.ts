import type { GuardRules } from "./remote-import-guard-check"

// T1a of #14943 (design section 5, deliverable 3): one resolution function. The ladder (the thread-part match), the
// locators (an address resolved to a holder) and the device lookups are held by the cores only: the address core, the
// remote module (the account's ladder resolve stands on), and the thread core's gateway, transports and control. An entry
// or adapter (the thread tools, the SDK, the omo CLI, the TUI) asks thread/address/contract.ts `resolve` instead.
const THREAD = "packages/omo-senpi/src/components/thread/"
const REMOTE = "packages/omo-senpi/src/components/remote/"

const isTestFile = (file: string): boolean =>
  file.endsWith(".test.ts") || file.split("/").some((segment) => segment === "test" || segment === "testing")

export const ADDRESS_PURITY_RULES: GuardRules = {
  testFile: isTestFile,
  s1: [],
  s2Origins: [
    { names: ["matchThread", "resolveDevice"], modules: ["packages/thread-address-core/"] },
    { names: ["resolveTarget"], modules: [`${THREAD}addressing.ts`] },
    { names: ["resolveAddress", "resolveAccountDevice"], modules: [`${THREAD}address/`] },
    { names: ["resolveRemoteDevice"], modules: [`${REMOTE}resolve.ts`] },
  ],
  s2AllowedImporters: [
    "packages/thread-address-core/",
    `${THREAD}address/`,
    `${THREAD}addressing.ts`,
    `${THREAD}gateway/`,
    `${THREAD}remote/`,
    `${THREAD}control/`,
    // The barrels re-export the address core for the sidecar runtime; they hold no ladder of their own.
    `${THREAD}index.ts`,
    `${THREAD}live-surface.ts`,
    `${REMOTE}attach.ts`,
    `${REMOTE}client.ts`,
    `${REMOTE}resolve.ts`,
    `${REMOTE}sessions.ts`,
  ],
  s3: { surface: () => false, layers: [], entry: "" },
}

type Offender = { readonly uses: readonly string[]; readonly removedBy: string }

// Today's adapters that still hold a lookup of their own; the list only shrinks (a new holder fails, and a removed one
// must leave the list in the same pull request).
export const ADDRESS_PURITY_OFFENDERS: Readonly<Record<string, Offender>> = {
  "packages/omo-native/account-devices.ts": {
    uses: ["resolveDevice"],
    removedBy: "T1a deliverable 4: omo account devices revoke resolves its device through devices.resolve on the root",
  },
  "packages/omo-senpi/src/components/thread/tools/internals.ts": {
    uses: ["resolveTarget"],
    removedBy:
      "T1a: the send book's disk scan asks the address core whether a name matched (sendAddressBook into address/)",
  },
}
