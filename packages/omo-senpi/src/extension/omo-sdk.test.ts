import { expect, test } from "bun:test"
import { createOmoSdk, SDK_VERSION } from "./omo-sdk"

// The source entry the runtime bundle is built from: its exported names are the eval cells' API.
test("#given the source entry #when a read runs with no sign-in #then it answers signed_out and the version is dev", async () => {
  const sdk = createOmoSdk({ ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })
  const result = await sdk.account.whoami()
  expect(result.kind === "error" ? result.error.code : result.kind).toBe("signed_out")
  expect(SDK_VERSION).toBe("dev")
})
