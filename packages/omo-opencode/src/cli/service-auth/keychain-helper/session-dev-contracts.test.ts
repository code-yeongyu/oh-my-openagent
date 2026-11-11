import { describe, expect, test } from "bun:test"
import { heldCredentialLease, withCredentialLock } from "../credential-lock"
import { credentialId, InvalidCredentialState, KeychainApprovalPendingError } from "../keystore"
import { fakeApi, grant, temporaryHome } from "../test-support"
import { A, API, credentials, fakeKeychain, helperSession } from "./fake-keychain.test-support"

const stored = JSON.stringify(credentials)
const generationOf = (text: string | undefined): unknown =>
  (JSON.parse(text ?? "{}") as { credentialGeneration?: unknown }).credentialGeneration

// The store's helper view under the service-auth contracts dev added after #11589 branched (#11262).
describe("the keychain helper path under dev's credential contracts", () => {
  test("#given a section holding the origin lock #when a nested section takes it again #then both run on the outer lease", async () => {
    const home = await temporaryHome()
    const [outer, nested, held] = await withCredentialLock(
      API,
      async (lease) => [
        lease,
        await withCredentialLock(API, async (again) => again, home),
        heldCredentialLease(API, home),
      ],
      home,
    )
    expect(nested).toBe(outer)
    expect(held).toBe(outer)
    expect(heldCredentialLease(API, home)).toBeUndefined()
  })

  test("#given an approved item another writer changed since #when a locked section reads authoritatively #then it sees the change and opens no dialog under the lock", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, stored, "runtime", "ours")
    const { store, session } = await helperSession(keychain)
    const read = session.transaction(async () => {
      keychain.put(A, JSON.stringify({ ...credentials, accessToken: "other-writer" }), "runtime", "ours")
      return store.readAuthoritative()
    })
    await expect(read).rejects.toBeInstanceOf(KeychainApprovalPendingError)
    expect(keychain.stats.approves).toBe(1)
  })

  test("#given helper writes #when identities change #then generations are assigned from a fresh read (A -> B -> A never restores A's)", async () => {
    const keychain = fakeKeychain()
    const { store, session } = await helperSession(keychain)
    await session.save(credentials)
    const first = generationOf(keychain.items.get(A)?.value)
    expect(typeof first).toBe("string")
    await store.write({ ...credentials, accessToken: "rotated" })
    expect(generationOf(keychain.items.get(A)?.value)).toBe(first)
    const captured = JSON.parse(keychain.items.get(A)?.value ?? "null")
    keychain.put(
      A,
      JSON.stringify({
        ...credentials,
        device: { ...credentials.device, id: "device-b" },
        credentialGeneration: "generation-b",
      }),
      "helper",
    )
    await session.update(async () => store.write(captured))
    const after = generationOf(keychain.items.get(A)?.value)
    expect([first, "generation-b"]).not.toContain(after)
    expect(keychain.stats).toEqual({ approves: 0, unleasedMutations: 0 })
  })

  test("#given an expired helper-owned sign-in #when a token is needed #then the journal and the rotated tokens go through the helper under the lease", async () => {
    let refreshes = 0
    const api = fakeApi(async () => {
      refreshes++
      return Response.json({ ...grant, accessToken: "new-access", refreshToken: "new-refresh" })
    })
    const keychain = fakeKeychain()
    const account = credentialId(api)
    keychain.put(
      account,
      JSON.stringify({ ...credentials, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" }),
      "helper",
    )
    const { session } = await helperSession(keychain, false, { api })
    expect(await session.accessToken()).toBe("new-access")
    expect(refreshes).toBe(1)
    expect(JSON.parse(keychain.items.get(account)?.value ?? "null")).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    })
    expect(keychain.events.filter((event) => event.startsWith("write"))).toHaveLength(2)
    expect(keychain.stats).toEqual({ approves: 0, unleasedMutations: 0 })
  })

  test("#given no sign-in item #when a locked section reads #then only the locked view reads it, never the outside-lock reader as well", async () => {
    const keychain = fakeKeychain()
    const { store, session } = await helperSession(keychain)
    const reads = () => keychain.events.filter((event) => event.startsWith("read ")).length
    const { inside, plain, authoritative } = await session.transaction(async () => {
      const before = reads()
      const value = await store.read()
      const between = reads()
      await store.readAuthoritative()
      return { inside: between - before, plain: value, authoritative: reads() - between }
    })
    expect(plain).toBeNull()
    expect(inside).toBe(1)
    expect(authoritative).toBe(1)
  })

  test("#given an unreadable helper-owned item #when read #then dev's recovery text (omo account forget)", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, "{not json", "helper")
    const { store } = await helperSession(keychain)
    const failure = store.read()
    await expect(failure).rejects.toBeInstanceOf(InvalidCredentialState)
    await expect(failure).rejects.toThrow("omo account forget")
  })
})
