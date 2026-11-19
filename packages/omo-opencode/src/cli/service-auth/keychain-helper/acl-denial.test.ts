import { expect, test } from "bun:test"
import { CredentialStoreError, KeychainLockedError } from "../keystore"
import { createApprovalCache } from "./approval-cache"
import { asKeystoreError } from "./darwin-backend"
import { lockedDarwinStore } from "./darwin-store"

const account = "a".repeat(64)

test("#given the helper reports an access-list refusal #when the sign-in is removed #then the error does not say the keychain is locked", async () => {
  let ownDeletes = 0
  const store = lockedDarwinStore(
    {
      account,
      access: {
        kind: "ready",
        path: "/fake/omo-keychain",
        call: async () => ({ error: "acl" as const, status: -25293 }),
      },
      cache: createApprovalCache(),
      background: true,
      takePromptLock: async () => async () => {},
      ownSilentGet: async () => null,
      ownOverwrite: async () => {},
      ownDelete: async () => {
        ownDeletes += 1
        return true
      },
      notice: () => {},
    },
    { handOver: async () => {}, restore: async () => {} },
  )

  const thrown = await store.clear().then(
    () => undefined,
    (error: unknown) => error,
  )
  const mapped = asKeystoreError(thrown, (message) => new Error(message))

  expect(ownDeletes).toBe(0)
  expect(mapped).toBeInstanceOf(CredentialStoreError)
  expect(mapped).not.toBeInstanceOf(KeychainLockedError)
  if (!(mapped instanceof CredentialStoreError)) throw new Error("expected a credential store error")
  expect(mapped.message).toContain("access list")
  expect(mapped.message).toContain("unlocked")
  expect(mapped.message).not.toContain("Unlock")
})
