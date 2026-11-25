import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { KeychainLockedError } from "@oh-my-opencode/account-core"
import { assembleOmoSdk } from "../assembly"

// account.show on the root (first-party design 6.4, slice A1b): the record `omo account show` prints, read from the
// store, the signed-out marker and the sync pin only; an empty account is refused before the store is read; no stored
// secret reaches the answer (security design 6).

const CANARY = {
  accessToken: "show-canary-access",
  refreshToken: "show-canary-refresh",
  signing: "show-canary-signing",
}
const stored = {
  accessToken: CANARY.accessToken,
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: CANARY.refreshToken,
  device: { id: "dev-1", name: "laptop" },
  signingPrivateKey: CANARY.signing,
  sealingPrivateKey: "show-canary-sealing",
}
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function rootWith(read: () => Promise<unknown>, desktopLaunch = false) {
  const cwd = mkdtempSync(join(tmpdir(), "omo-sdk-show-"))
  dirs.push(cwd)
  const reads: number[] = []
  const sdk = assembleOmoSdk(
    {
      principal: { kind: "script", uid: 501 },
      env: { OMO_SERVICE_API_URL: "https://api.example.test", OMO_MEMORY_DIR: join(cwd, "memory") },
      cwd,
      ports: {
        desktopLaunch: () => desktopLaunch,
        credentialStore: {
          read: async () => {
            reads.push(1)
            return (await read()) as never
          },
          storage: () => "keyring",
        },
      },
    },
    {},
  )
  return { sdk, reads }
}

describe("account.show on the root", () => {
  test("#given a stored sign-in #when shown with an account #then it answers the printed record and no stored secret", async () => {
    const { sdk } = rootWith(async () => stored)
    const shown = await sdk.account.show({ account: "acct-1" })
    expect(shown).toEqual({
      kind: "ok",
      value: {
        signedIn: true,
        device: { id: "dev-1", name: "laptop" },
        refreshState: "ok",
        sync: "not_joined",
        storage: "keyring",
      },
    })
    for (const canary of Object.values(CANARY)) expect(JSON.stringify(shown)).not.toContain(canary)
  })

  test("#given no stored sign-in #when shown #then it answers signed out", async () => {
    const { sdk } = rootWith(async () => null)
    expect(await sdk.account.show()).toEqual({ kind: "ok", value: { signedIn: false, storage: "keyring" } })
  })

  test("#given an empty account #when shown #then it refuses invalid_arguments before the store is read", async () => {
    const { sdk, reads } = rootWith(async () => stored)
    expect(await sdk.account.show({ account: "" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(reads).toEqual([])
  })

  test("#given a locked keychain #when shown #then it answers credential_store_locked", async () => {
    const { sdk } = rootWith(async () => {
      throw new KeychainLockedError("synthetic lock with show-canary-access inside")
    })
    const shown = await sdk.account.show()
    expect(shown).toMatchObject({ kind: "error", error: { code: "credential_store_locked" } })
    expect(JSON.stringify(shown)).not.toContain(CANARY.accessToken)
  })

  test("#given a desktop launch #when shown #then it answers desktop_sign_in without reading the store", async () => {
    const { sdk, reads } = rootWith(async () => stored, true)
    expect(await sdk.account.show()).toMatchObject({ kind: "error", error: { code: "desktop_sign_in" } })
    expect(reads).toEqual([])
  })
})
