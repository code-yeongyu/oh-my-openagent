import { describe, expect, test } from "bun:test"
import { A, API, credentials, fakeKeychain, helperSession } from "../../omo-opencode/src/cli/service-auth/keychain-helper/fake-keychain.test-support"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"

async function account(keychain: ReturnType<typeof fakeKeychain>, args: string[], stdin = "") {
  const { store, home } = await helperSession(keychain)
  const output: string[] = []
  const code = await runAccountVerb(
    { api: API, store, home, pinDir: () => home, readStdin: async () => stdin, output: line => output.push(line), error: () => {} },
    args,
  )
  return { code, reply: JSON.parse(output.at(-1) ?? "null") }
}

// `omo account` verbs on a sign-in the keychain helper owns: every change happens under the lease (#11262 design 3.6).
describe("omo account over the keychain helper", () => {
  test("#given a helper-owned sign-in #when forget --device names it #then the helper removes it under the lease", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, JSON.stringify(credentials), "helper")
    expect(await account(keychain, ["forget", "--device", credentials.device.id])).toEqual({ code: ACCOUNT_EXIT.ok, reply: { forgotten: true } })
    expect([...keychain.items.keys()]).toEqual([])
    expect(keychain.stats.unleasedMutations).toBe(0)
  })

  test("#given a helper-owned sign-in #when forget --device names another device #then a conflict and the item stays", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, JSON.stringify(credentials), "helper")
    const { code } = await account(keychain, ["forget", "--device", "someone-else"])
    expect(code).toBe(ACCOUNT_EXIT.conflict)
    expect(keychain.items.has(A)).toBe(true)
  })

  test("#given an unreadable helper-owned item #when forget, then adopt --replace #then forget clears it and adopt replaces it", async () => {
    const keychain = fakeKeychain()
    keychain.put(A, "{not json", "helper")
    expect((await account(keychain, ["forget", "--device", credentials.device.id])).reply).toEqual({ forgotten: false, error: "unreadable-credential" })
    expect((await account(keychain, ["forget"])).reply).toEqual({ forgotten: true })
    expect(keychain.items.has(A)).toBe(false)
    keychain.put(A, "{not json", "helper")
    expect((await account(keychain, ["adopt", "--replace"], JSON.stringify(credentials))).code).toBe(ACCOUNT_EXIT.ok)
    expect(JSON.parse(keychain.items.get(A)?.value ?? "null")).toMatchObject({ refreshToken: credentials.refreshToken })
    expect(keychain.stats.unleasedMutations).toBe(0)
  })
})
