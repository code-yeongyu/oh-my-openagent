import { describe, expect, test } from "bun:test"
import { createCredentialStore, KeychainApprovalPendingError, KeychainLockedError } from "../keystore"
import { A, API, credentials, fakeKeychain, helperSession } from "./fake-keychain.test-support"

const stored = JSON.stringify(credentials)

describe("sign-in through the signed keychain helper (#11262 design 3, addendum)", () => {
  test("#given a fresh sign-in #when it is saved #then the helper creates its own marked item, under the lease, with no dialog", async () => {
    const keychain = fakeKeychain()
    const { session } = await helperSession(keychain)
    await session.save(credentials)
    expect(keychain.items.get(A)).toMatchObject({ owner: "helper", marker: true })
    expect(keychain.stats).toEqual({ approves: 0, unleasedMutations: 0 })
  })

  test("#given an item this process's own identity created (row 6) #when a token is used #then it moves to the helper silently", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "bun", "other")
    const { session } = await helperSession(keychain)
    expect(await session.accessToken()).toBe(credentials.accessToken)
    expect(keychain.items.get(A)).toMatchObject({ owner: "helper", marker: true })
    expect([...keychain.items.keys()]).toEqual([A])
    expect(keychain.stats).toEqual({ approves: 0, unleasedMutations: 0 })
    expect(keychain.events.filter(event => /stage|retire|promote/.test(event))).toEqual(["stage <A>", "retire <A>", "promote <A>"])
  })

  test("#given an item the app created, app gone (rows 7, 22) #when token, refresh-free reads and accessToken run #then one plain dialog in total and the item is the helper's afterwards", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "runtime", "ours")
    const { store, session } = await helperSession(keychain)
    expect(await store.read()).toEqual(credentials)
    expect(await session.accessToken()).toBe(credentials.accessToken)
    expect(await store.read()).toEqual(credentials)
    expect(keychain.stats.approves).toBe(1)
    expect(keychain.items.get(A)?.owner).toBe("helper")
  })

  test("#given a Deny (row 23) #when background paths read again #then they never re-ask; an interactive command asks again", async () => {
    const keychain = fakeKeychain({ approve: "deny" })
    keychain.put(A, stored, "runtime", "ours")
    const background = await helperSession(keychain, true)
    await expect(background.store.read()).rejects.toThrow()
    await expect(background.store.read()).rejects.toBeInstanceOf(KeychainApprovalPendingError)
    expect(keychain.stats.approves).toBe(1)
    const interactive = await helperSession(keychain)
    await expect(interactive.store.read()).rejects.toThrow()
    expect(keychain.stats.approves).toBe(2)
  })

  test("#given a headless session (row 18) #when approve cannot show #then today's locked error class", async () => {
    const keychain = fakeKeychain({ approve: "locked" })
    keychain.put(A, stored, "runtime", "ours")
    const { session } = await helperSession(keychain)
    await expect(session.accessToken()).rejects.toBeInstanceOf(KeychainLockedError)
  })

  test("#given approve answers locked with no UI #when a background path reads again #then locked again, never a remembered Deny", async () => {
    const keychain = fakeKeychain({ approve: "locked" })
    keychain.put(A, stored, "runtime", "ours")
    const background = await helperSession(keychain, true)
    await expect(background.store.read()).rejects.toBeInstanceOf(KeychainLockedError)
    await expect(background.store.read()).rejects.toBeInstanceOf(KeychainLockedError)
    expect(keychain.stats.approves).toBe(2)
  })

  test("#given a crashed migration (staging + .old, no original) #when any locked section runs #then recovery promotes it first", async () => {
    const keychain = fakeKeychain()
    keychain.put(`${A}.staging`, stored, "helper")
    keychain.put(`${A}.old`, stored, "bun")
    const { session } = await helperSession(keychain)
    await session.update(async current => expect(current).toEqual(credentials))
    expect(keychain.items.get(A)?.owner).toBe("helper")
    expect([...keychain.items.keys()]).toEqual([A])
  })

  test("#given a store without a verified helper and a helper-owned item (row 9b) #when read #then the one-line reinstall notice, no dialog", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "helper")
    const store = createCredentialStore(API, {
      secrets: keychain.secrets,
      platform: "darwin",
      lockProbe: async () => "unlocked",
      keychainHelper: { access: async () => ({ kind: "missing" }), ownerMarker: async () => "helper-owned" },
    })
    await expect(store.read()).rejects.toThrow("Reinstall omo")
    expect(keychain.stats.approves).toBe(0)
  })

  test.each(["linux", "win32"] as const)("#given %s #when the store reads and writes #then the helper is never consulted", async platform => {
    const keychain = fakeKeychain()
    let consulted = 0
    const store = createCredentialStore(API, {
      secrets: keychain.secrets,
      platform,
      lockProbe: async () => "unlocked",
      keychainHelper: {
        access: async () => {
          consulted++
          return keychain.access
        },
      },
    })
    await store.write(credentials)
    expect(await store.read()).toEqual(credentials)
    expect(consulted).toBe(0)
    expect(keychain.events).toEqual([])
  })
})
