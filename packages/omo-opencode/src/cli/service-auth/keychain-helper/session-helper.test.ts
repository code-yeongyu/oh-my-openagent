import { describe, expect, test } from "bun:test"
import { createCredentialStore, KeychainApprovalPendingError, KeychainLockedError } from "../keystore"
import { A, API, credentials, fakeKeychain, helperSession } from "./fake-keychain.test-support"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { onTestFinished } from "bun:test"
import { createCreatorHandOff, HANDOFF_ENV } from "./creator-handoff"

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

// Addendum change 1 with the #11613 review: the hand-off runs only where this process would show its one dialog, and the
// hand-off child (the desktop runtime, marked) never shows one. Dialogs are counted across BOTH processes.
describe("creator hand-off across two processes (#11262 addendum rows 7, 8)", () => {
  function handOffTo(keychain: ReturnType<typeof fakeKeychain>) {
    let ran = 0
    const handOff = async () => {
      ran++
      const creator = await helperSession(keychain, false, { identity: "runtime", noDialog: true })
      return creator.session.accessToken().then(
        () => true,
        () => false,
      )
    }
    return { handOff, runs: () => ran }
  }

  test("#given an item the desktop runtime created #when the CLI needs it #then the runtime moves it silently and there is no dialog at all", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "runtime", "ours")
    const creator = handOffTo(keychain)
    const { session } = await helperSession(keychain, false, { handOff: creator.handOff })
    expect(await session.accessToken()).toBe(credentials.accessToken)
    expect(creator.runs()).toBe(1)
    expect(keychain.items.get(A)?.owner).toBe("helper")
    expect(keychain.stats.approves).toBe(0)
  })

  test("#given an item neither side can read silently #when the CLI needs it #then the marked child shows nothing and the CLI shows exactly one dialog", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "other-app", "ours")
    const creator = handOffTo(keychain)
    const { session } = await helperSession(keychain, false, { handOff: creator.handOff })
    expect(await session.accessToken()).toBe(credentials.accessToken)
    expect(creator.runs()).toBe(1)
    expect(keychain.stats.approves).toBe(1)
  })

  test("#given an item for the row 8b re-login path #when read #then no hand-off runs and no dialog shows", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "runtime", "other")
    const creator = handOffTo(keychain)
    const { store } = await helperSession(keychain, false, { handOff: creator.handOff })
    expect(await store.read()).toBeNull()
    expect(creator.runs()).toBe(0)
    expect(keychain.stats.approves).toBe(0)
  })

  test("#given an already-shipped desktop runtime (no keychain helper in its bundle) #when the CLI needs the item #then it is never spawned and the CLI shows exactly one dialog", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "runtime", "ours")
    const root = await mkdtemp(join(tmpdir(), "old-runtime-"))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    // The desktop layout written out literally (desktop#5057); an omo-ai 5.1.48 runtime ships no capability file.
    const runtimeDir = join(root, "Applications/OmO.app/Contents/Resources/omo-runtime/darwin-arm64")
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(join(runtimeDir, "omo"), "omo 5.1.48")
    await writeFile(join(runtimeDir, "omo-keychain"), "helper")
    const old = { app: join(root, "Applications/OmO.app"), runtime: join(runtimeDir, "omo") }
    let spawned = 0
    const handOff = createCreatorHandOff({
      candidates: [old],
      env: {},
      checkBundle: async () => true,
      checkRuntime: async () => true,
      run: async () => {
        spawned++
        return 0
      },
      selfPath: "/x",
    })
    const { session } = await helperSession(keychain, false, { handOff })
    expect(await session.accessToken()).toBe(credentials.accessToken)
    expect(spawned).toBe(0)
    expect(keychain.stats.approves).toBe(1)
  })

  test("#given a marked hand-off child with no helper #when it reads #then it refuses instead of today's interactive read", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "other-app", "ours")
    const store = createCredentialStore(API, {
      secrets: keychain.secretsAs("runtime"),
      platform: "darwin",
      lockProbe: async () => "unlocked",
      notice: () => {},
      keychainHelper: { access: async () => ({ kind: "missing" }), noDialog: true, ownerMarker: async () => "absent" },
    })
    await expect(store.read()).rejects.toBeInstanceOf(KeychainApprovalPendingError)
    expect(keychain.stats.approves).toBe(0)
  })

  test("#given only OMO_KEYCHAIN_HANDOFF=1 in the environment #when that process reads an item it cannot read silently #then no dialog", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "other-app", "ours")
    const previous = process.env[HANDOFF_ENV]
    process.env[HANDOFF_ENV] = "1"
    try {
      const { store } = await helperSession(keychain, false, { identity: "runtime" })
      await expect(store.read()).rejects.toBeInstanceOf(KeychainApprovalPendingError)
    } finally {
      if (previous === undefined) delete process.env[HANDOFF_ENV]
      else process.env[HANDOFF_ENV] = previous
    }
    expect(keychain.stats.approves).toBe(0)
  })

  test("#given a hand-off whose spawn fails #when the CLI needs the item #then it falls through to exactly one dialog", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "other-app", "ours")
    const { session } = await helperSession(keychain, false, { handOff: async () => false })
    expect(await session.accessToken()).toBe(credentials.accessToken)
    expect(keychain.stats.approves).toBe(1)
  })
})
