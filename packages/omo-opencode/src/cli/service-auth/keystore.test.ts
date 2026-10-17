import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { createCredentialStore } from "./keystore"
import { grant, memorySecrets, privateKeys } from "./test-support"

describe("OS credential storage", () => {
  test.each(["darwin", "linux", "win32"] as const)("delegates %s storage exclusively to the in-process secret API", async platform => {
    const memory = memorySecrets()
    const store = createCredentialStore("https://api.omo.dev", memory.api, platform)
    const record = { ...grant, ...privateKeys }
    await store.write(record)
    expect(await store.read()).toMatchObject(record)
    expect(memory.values.size).toBe(1)
    expect(JSON.parse(memory.writes[0] ?? "")).toMatchObject(record)
    await store.clear()
    expect(await store.read()).toBeNull()
  })

  test("isolates origins and canonicalizes trailing slash", async () => {
    const memory = memorySecrets()
    await memory.store("https://api.omo.dev/").write({ ...grant, ...privateKeys })
    expect(await memory.store("https://api.omo.dev").read()).not.toBeNull()
    expect(await memory.store("https://other.example").read()).toBeNull()
  })

  test("unavailable store fails without exposing native error contents", async () => {
    const store = createCredentialStore("https://api.omo.dev", {
      get: async () => { throw new Error(grant.refreshToken) },
      set: async () => { throw new Error(grant.refreshToken) },
      delete: async () => { throw new Error(grant.refreshToken) },
    }, "linux")
    for (const action of [() => store.read(), () => store.write({ ...grant, ...privateKeys }), () => store.clear()]) {
      try { await action(); throw new Error("unexpected success") } catch (error) {
        expect(String(error)).toContain("Secret Service")
        expect(String(error)).not.toContain(grant.refreshToken)
      }
    }
  })

  test("unsupported runtimes fail closed with no file fallback", () => {
    expect(() => createCredentialStore("https://api.omo.dev", null, "linux")).toThrow("Bun")
  })

  test.skipIf(process.env.OMO_TEST_REAL_KEYSTORE !== "1")("opt-in real OS keystore smoke", async () => {
    const store = createCredentialStore(`https://${randomUUID()}.example`)
    try {
      await store.write({ ...grant, ...privateKeys })
      expect((await store.read())?.refreshToken).toBe(grant.refreshToken)
    } finally {
      await store.clear()
    }
  })
})
