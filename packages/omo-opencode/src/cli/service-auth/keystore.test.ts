import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { lstat, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import {
  createCredentialStore,
  CredentialStoreError,
  credentialId,
  InvalidCredentialState,
  KeychainLockedError,
  type SecretApi,
} from "./keystore"
import type { SecretServiceLockState } from "./secret-service-lock"
import { grant, memorySecrets, privateKeys, temporaryHome } from "./test-support"

describe("OS credential storage", () => {
  test.each(["read", "readAuthoritative"] as const)(
    "%s reports corrupt credentials with the account-forget recovery error",
    async (read) => {
      const store = createCredentialStore("https://api.omo.dev", {
        platform: "darwin",
        secrets: {
          get: async () => "{",
          set: async () => {
            throw new Error("unexpected write")
          },
          delete: async () => {
            throw new Error("unexpected delete")
          },
        },
      })
      const error = await store[read]().catch((error) => error)
      expect(error).toBeInstanceOf(InvalidCredentialState)
      expect(error.message).toBe(
        "The OmO sign-in saved on this computer can't be read. Run omo account forget to remove it, then sign in again from the OmO desktop app on this computer, or with omo login in a terminal.",
      )
    },
  )

  test.each(["darwin", "linux", "win32"] as const)(
    "delegates %s storage exclusively to the in-process secret API",
    async (platform) => {
      const memory = memorySecrets()
      const store = createCredentialStore("https://api.omo.dev", {
        secrets: memory.api,
        platform,
        lockProbe: async () => "unlocked",
      })
      const record = { ...grant, ...privateKeys }
      await store.write(record)
      expect(await store.read()).toMatchObject(record)
      expect(memory.values.size).toBe(1)
      expect(JSON.parse(memory.writes[0] ?? "")).toMatchObject(record)
      await store.clear()
      expect(await store.read()).toBeNull()
    },
  )

  test("isolates origins and canonicalizes trailing slash", async () => {
    const memory = memorySecrets()
    await memory.store("https://api.omo.dev/").write({ ...grant, ...privateKeys })
    expect(await memory.store("https://api.omo.dev").read()).not.toBeNull()
    expect(await memory.store("https://other.example").read()).toBeNull()
  })

  test("unavailable store fails without exposing native error contents", async () => {
    const store = createCredentialStore("https://api.omo.dev", {
      secrets: {
        get: async () => {
          throw new Error(grant.refreshToken)
        },
        set: async () => {
          throw new Error(grant.refreshToken)
        },
        delete: async () => {
          throw new Error(grant.refreshToken)
        },
      },
      platform: "linux",
      lockProbe: async () => "unlocked",
    })
    for (const action of [() => store.read(), () => store.write({ ...grant, ...privateKeys }), () => store.clear()]) {
      try {
        await action()
        throw new Error("unexpected success")
      } catch (error) {
        expect(String(error)).toContain("Secret Service")
        expect(String(error)).not.toContain(grant.refreshToken)
      }
    }
  })

  test.each(["darwin", "win32"] as const)(
    "unsupported runtimes on %s fail closed with no file fallback",
    (platform) => {
      expect(() => createCredentialStore("https://api.omo.dev", { secrets: null, platform })).toThrow("Bun")
    },
  )

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

describe("Linux with no Secret Service keeps the shared sign-in in a private state file (#7185b)", () => {
  const api = "https://api.omo.dev"
  const record = { ...grant, ...privateKeys }
  const stateFile = (home: string) => join(home, ".omo", "account-state", `omo-cli-${credentialId(api)}.json`)
  const missing = async (path: string) => (await lstat(path).catch(() => null)) === null
  const watched = (secrets: SecretApi = memorySecrets().api) => {
    const calls: string[] = []
    const api: SecretApi = {
      get: (key) => {
        calls.push("get")
        return secrets.get(key)
      },
      set: (key) => {
        calls.push("set")
        return secrets.set(key)
      },
      delete: (key) => {
        calls.push("delete")
        return secrets.delete(key)
      },
    }
    return { api, calls }
  }
  const linuxStore = (home: string, secrets: SecretApi | null, lock: SecretServiceLockState, notices: string[] = []) =>
    createCredentialStore(api, {
      secrets,
      platform: "linux",
      lockProbe: async () => lock,
      home,
      notice: (message) => {
        notices.push(message)
      },
    })

  test("#given no Secret Service on the bus #then the sign-in round-trips through a 0600 file and libsecret is never called", async () => {
    const home = await temporaryHome()
    const secrets = watched()
    const notices: string[] = []
    const store = linuxStore(home, secrets.api, "absent", notices)
    await store.write(record)
    expect(await store.read()).toMatchObject(record)
    expect(await store.readAuthoritative()).toMatchObject(record)
    expect(store.storage?.()).toBe("file")
    expect((await stat(stateFile(home))).mode & 0o777).toBe(0o600)
    expect(secrets.calls).toEqual([])
    expect(notices).toHaveLength(1)
    expect(notices.join("\n")).not.toContain(grant.refreshToken)
    await store.clear()
    expect(await missing(stateFile(home))).toBe(true)
    expect(await store.read()).toBeNull()
  })

  test("#given no Bun.secrets on Linux #then the state file is the store", async () => {
    const home = await temporaryHome()
    const store = linuxStore(home, null, "unknown")
    await store.write(record)
    expect(await store.read()).toMatchObject(record)
    expect(store.storage?.()).toBe("file")
  })

  test("#given an unlocked keyring #then libsecret holds the sign-in and no state file is written", async () => {
    const home = await temporaryHome()
    const memory = memorySecrets()
    const store = linuxStore(home, memory.api, "unlocked")
    await store.write(record)
    expect(await store.read()).toMatchObject(record)
    expect(store.storage?.()).toBe("keyring")
    expect(memory.values.size).toBe(1)
    expect(await missing(join(home, ".omo", "account-state"))).toBe(true)
  })

  test("#given a locked keyring #then it stays keychain-locked and nothing falls back to the file", async () => {
    const home = await temporaryHome()
    const secrets = watched()
    const store = linuxStore(home, secrets.api, "locked")
    await expect(store.write(record)).rejects.toBeInstanceOf(KeychainLockedError)
    await expect(store.read()).rejects.toBeInstanceOf(KeychainLockedError)
    expect(secrets.calls).toEqual([])
    expect(await missing(join(home, ".omo", "account-state"))).toBe(true)
  })

  test("#given a Secret Service whose store fails #then the failure stands and no state file is written", async () => {
    const home = await temporaryHome()
    const failing: SecretApi = {
      get: async () => {
        throw new Error("synthetic libsecret failure")
      },
      set: async () => {
        throw new Error("synthetic libsecret failure")
      },
      delete: async () => {
        throw new Error("synthetic libsecret failure")
      },
    }
    const store = linuxStore(home, failing, "unlocked")
    await expect(store.write(record)).rejects.toBeInstanceOf(CredentialStoreError)
    await expect(store.read()).rejects.toBeInstanceOf(CredentialStoreError)
    expect(await missing(join(home, ".omo", "account-state"))).toBe(true)
  })

  test("#given a state file and now an unlocked keyring #then the sign-in moves to libsecret, is read back, then the file goes", async () => {
    const home = await temporaryHome()
    await linuxStore(home, null, "absent").write(record)
    const written = await readFile(stateFile(home), "utf8")
    const memory = memorySecrets()
    const store = linuxStore(home, memory.api, "unlocked")
    expect(await store.read()).toMatchObject(record)
    expect(store.storage?.()).toBe("keyring")
    expect([...memory.values.values()]).toEqual([written])
    expect(await missing(stateFile(home))).toBe(true)
  })

  test("#given a state file and a keyring write that fails #then the file is kept", async () => {
    const home = await temporaryHome()
    await linuxStore(home, null, "absent").write(record)
    const written = await readFile(stateFile(home), "utf8")
    const refusing: SecretApi = {
      get: async () => null,
      set: async () => {
        throw new Error("synthetic libsecret write failure")
      },
      delete: async () => true,
    }
    await expect(linuxStore(home, refusing, "unlocked").read()).rejects.toBeInstanceOf(CredentialStoreError)
    expect(await readFile(stateFile(home), "utf8")).toBe(written)
  })

  test("#given a state file and a keyring read-back that differs #then the file is kept", async () => {
    const home = await temporaryHome()
    await linuxStore(home, null, "absent").write(record)
    const written = await readFile(stateFile(home), "utf8")
    const lossy: SecretApi = { get: async () => "{}", set: async () => {}, delete: async () => true }
    await expect(linuxStore(home, lossy, "unlocked").read()).rejects.toBeInstanceOf(CredentialStoreError)
    expect(await readFile(stateFile(home), "utf8")).toBe(written)
  })

  test("#given a probe that cannot answer #then an existing state file stays in use, and with none libsecret is used", async () => {
    const home = await temporaryHome()
    await linuxStore(home, null, "absent").write(record)
    const secrets = watched()
    const kept = linuxStore(home, secrets.api, "unknown")
    expect(await kept.read()).toMatchObject(record)
    expect(kept.storage?.()).toBe("file")
    expect(secrets.calls).toEqual([])
    await kept.clear()
    const fresh = linuxStore(home, secrets.api, "unknown")
    await fresh.write(record)
    expect(fresh.storage?.()).toBe("keyring")
    expect(secrets.calls).toContain("set")
    expect(await missing(stateFile(home))).toBe(true)
  })

  test("#when forgotten with both a state file and a keyring item #then both are removed", async () => {
    const home = await temporaryHome()
    await linuxStore(home, null, "absent").write(record)
    const memory = memorySecrets()
    await memory.api.set({ service: "omo-cli", name: credentialId(api), value: JSON.stringify(record) })
    await linuxStore(home, memory.api, "unlocked").clear()
    expect(await missing(stateFile(home))).toBe(true)
    expect(memory.values.size).toBe(0)
  })
})
