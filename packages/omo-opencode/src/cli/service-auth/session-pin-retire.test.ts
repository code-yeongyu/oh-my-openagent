// #12280 R-B7: the credential write seam retires a memory-sync trust pin exactly when the keys of the
// principal that earned it are discarded, through the shared hook every production caller passes.

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { CredentialStore } from "./keystore"
import { InvalidCredentialState } from "./keystore"
import type { Credentials } from "./protocol"
import { createSession } from "./session"
import { retireSyncPinOnDiscard } from "./sync-pin-retire"
import { fakeApi, grant, privateKeys, refusal, temporaryHome } from "./test-support"

const ACCOUNT = "account-r-b7"

async function pinnedHome() {
  const home = await temporaryHome()
  const pinDir = join(home, "sync-device")
  const parent = join(pinDir, "trust-anchor")
  const key = createHash("sha256").update(ACCOUNT, "utf8").digest("base64url")
  await mkdir(join(parent, key), { recursive: true })
  await writeFile(join(parent, key, "pin.json"), "{}\n")
  const logs: string[] = []
  return {
    home,
    hook: retireSyncPinOnDiscard({ pinDir: () => pinDir, log: (line) => logs.push(line) }),
    logs,
    pins: async () => {
      const names = await readdir(parent)
      return { live: names.filter((n) => n === key).length, retired: names.filter((n) => n.startsWith(`${key}.retired-`)).length }
    },
  }
}

function memoryStore(initial: Credentials | null, unreadable = false) {
  let value = initial
  const store: CredentialStore = {
    read: async () => value,
    readAuthoritative: async () => {
      if (unreadable) throw new InvalidCredentialState("the stored sign-in does not parse")
      return value
    },
    write: async (next) => { value = next },
    clear: async () => { value = null },
  }
  return { store, current: () => value }
}

const stored: Credentials = { ...grant, ...privateKeys, accountId: ACCOUNT }
const anotherDevice: Credentials = { ...grant, ...privateKeys, device: { id: "device-2", name: "New CLI" } }

describe("the credential write seam retires the sync pin (#12280)", () => {
  test("#given a stored sign-in #when a save replaces it with another device #then the previous principal's pin is retired and the new credential is stored", async () => {
    const h = await pinnedHome()
    const s = memoryStore(stored)
    await createSession({ api: "https://api.omo.dev", store: s.store, home: h.home, beforeKeysDiscarded: h.hook }).save(anotherDevice)
    expect(await h.pins()).toEqual({ live: 0, retired: 1 })
    expect(s.current()?.device.id).toBe("device-2")
  })

  test("#given a stored sign-in #when a save hands over fresh tokens for the same device #then the pin is kept", async () => {
    const h = await pinnedHome()
    const s = memoryStore(stored)
    await createSession({ api: "https://api.omo.dev", store: s.store, home: h.home, beforeKeysDiscarded: h.hook }).save({ ...stored, accessToken: "fresh" })
    expect(await h.pins()).toEqual({ live: 1, retired: 0 })
  })

  test("#given an unreadable stored item #when a save replaces it #then the new credential is stored, nothing is retired, and one line is logged", async () => {
    const h = await pinnedHome()
    const s = memoryStore(stored, true)
    await createSession({ api: "https://api.omo.dev", store: s.store, home: h.home, beforeKeysDiscarded: h.hook }).save(anotherDevice)
    expect(s.current()?.device.id).toBe("device-2")
    expect(await h.pins()).toEqual({ live: 1, retired: 0 })
    expect(h.logs).toHaveLength(1)
  })

  test("#given a credential that names its account only in its owner record #when the refresh is refused device_revoked #then that account's pin is retired", async () => {
    const h = await pinnedHome()
    const owner = { accountId: ACCOUNT, deviceId: "device-1", familyId: "family-1", generation: 1, ownerHandle: "handle-1" }
    const s = memoryStore({ ...grant, ...privateKeys, owner, accessTokenExpiresAt: "2000-01-01T00:00:00Z" })
    const api = fakeApi(() => refusal("device_revoked", undefined, 401))
    const error = await createSession({ api, store: s.store, home: h.home, beforeKeysDiscarded: h.hook }).accessToken().catch((e: unknown) => e)
    expect(error).toMatchObject({ code: "device_revoked" })
    expect(s.current()).toBeNull()
    expect(await h.pins()).toEqual({ live: 0, retired: 1 })
  })

  test("#given a stored sign-in #when it is logged out #then its pin is retired", async () => {
    const h = await pinnedHome()
    const s = memoryStore(stored)
    const api = fakeApi(() => new Response(null, { status: 204 }))
    await createSession({ api, store: s.store, home: h.home, beforeKeysDiscarded: h.hook }).logout()
    expect(s.current()).toBeNull()
    expect(await h.pins()).toEqual({ live: 0, retired: 1 })
  })

  // #12303 review HIGH: a sign-in that names no account is the usual case (it never ran `omo sync`), so
  // discarding it is silent.
  test("#given a sign-in that names no account and no pin to retire #when it is logged out #then nothing is logged and the service sees only the revoke", async () => {
    const h = await pinnedHome()
    const calls: string[] = []
    const api = fakeApi((request) => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`)
      return new Response(null, { status: 204 })
    })
    const s = memoryStore({ ...grant, ...privateKeys })
    const hook = retireSyncPinOnDiscard({ pinDir: () => join(h.home, "elsewhere"), log: (line) => h.logs.push(line) })
    await createSession({ api, store: s.store, home: h.home, beforeKeysDiscarded: hook }).logout()
    expect(s.current()).toBeNull()
    expect(h.logs).toEqual([])
    expect(calls).toEqual(["DELETE /v1/devices/device-1"])
  })

  // #12303 review LOW: a pin earned by `omo sync` before the account was stamped on the credential.
  test("#given a legacy sign-in with no account and a live pin #when it is logged out #then the account is read before the revoke and its pin is retired", async () => {
    const h = await pinnedHome()
    const calls: string[] = []
    const api = fakeApi((request) => {
      const path = new URL(request.url).pathname
      calls.push(`${request.method} ${path}`)
      return path === "/v1/me" ? Response.json({ user: { id: "user-1" }, account: { id: ACCOUNT } }) : new Response(null, { status: 204 })
    })
    const s = memoryStore({ ...grant, ...privateKeys })
    await createSession({ api, store: s.store, home: h.home, beforeKeysDiscarded: h.hook }).logout()
    expect(calls).toEqual(["GET /v1/me", "DELETE /v1/devices/device-1"])
    expect(await h.pins()).toEqual({ live: 0, retired: 1 })
    expect(h.logs).toEqual([])
  })
})
