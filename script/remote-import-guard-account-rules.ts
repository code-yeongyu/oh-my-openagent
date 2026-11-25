import type { AdapterRules } from "./remote-import-guard-adapter"

// Family A, the account core's side (#14364, slice A1a of #14943; design 3.1 and 7.5). The account core is the one
// implementation of the account domain: it imports no edition package (every `cli/` directory lives in one), and no file
// outside it holds credential-store, device-key or device-code logic. The adapter side of the same rule is ADAPTER_RULES.
export const ACCOUNT_CORE = "packages/account-core/src/"

const EDITION_PACKAGES = [
  "packages/omo-opencode/",
  "packages/omo-native/",
  "packages/omo-senpi/",
  "packages/omo-codex/",
] as const

// Every file of the package walks, tests included: a core test that imports an edition package belongs to that edition.
export const ACCOUNT_CORE_RULES: AdapterRules = {
  adapter: (file) => file.startsWith("packages/account-core/"),
  testFile: () => false,
  sdkEntries: [],
  forbidden: EDITION_PACKAGES,
  forbiddenBuiltins: [],
}

// The primitives only that logic touches, each a literal no other domain uses: the OS credential facilities a credential
// store or this device's keyring writes through, and the account service's device-code routes. Tests, fixtures and test
// support are not logic and are not scanned.
export const ACCOUNT_LOGIC_MARKERS: Readonly<Record<string, readonly string[]>> = {
  "credential store or device keys": [
    "SecItem",
    "/usr/bin/security",
    "find-generic-password",
    "org.freedesktop.secrets",
    "secret-tool",
    "libsecret",
    "CredentialReadW",
  ],
  "device-code flow": ["/v1/device/code", "/v1/device/token"],
}
