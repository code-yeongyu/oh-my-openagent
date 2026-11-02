import { describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { createCredentialStore, type Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
import { createCliAccountSource } from "./account-source"

const keys = () => ({
  signingPrivateKey: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
})

describe("CLI operation-scoped account", () => {
  for (const transition of ["account", "device", "signing", "sealing", "aba", "clear", "refresh"] as const) {
    test(`fences signing and service dispatch after ${transition}`, async () => {
      let sealed: string | null = null
      const store = createCredentialStore("https://api.example.test", { platform: "darwin", secrets: {
        get: async () => sealed,
        set: async ({ value }) => { sealed = value },
        delete: async () => { sealed = null; return true },
      } })
      const original: Credentials = {
        ...keys(), accessToken: "access", refreshToken: "refresh", accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        device: { id: "service-device", name: "fixture" }, accountId: "account",
      }
      await store.write(original)
      const sent: string[] = []
      const account = await createCliAccountSource({
        api: "https://api.example.test", store,
        fetch: Object.assign(async (url: Parameters<typeof fetch>[0]) => {
          const path = new URL(String(url)).pathname
          if (path === "/v1/me") return Response.json({ account: { id: "account" }, deviceId: "service-device" })
          if (path === "/v1/devices") return Response.json({ devices: [{ id: "service-device", current: true, revokedAt: null }] })
          sent.push(path)
          return Response.json({ pending: [] })
        }, { preconnect: fetch.preconnect }),
      })()
      if (account === null) throw new Error("missing fixture account")
      const operation = await account.forOperation({ signal: new AbortController().signal, admit: effect => effect() })
      const captured = await store.read()
      if (captured === null) throw new Error("missing stored fixture")
      const rotated = keys()
      switch (transition) {
        case "account": await store.write({ ...captured, accountId: "other" }); break
        case "device": await store.write({ ...captured, device: { ...captured.device, id: "other" } }); break
        case "signing": await store.write({ ...captured, signingPrivateKey: rotated.signingPrivateKey }); break
        case "sealing": await store.write({ ...captured, sealingPrivateKey: rotated.sealingPrivateKey }); break
        case "aba":
          await store.write({ ...captured, device: { ...captured.device, id: "other" } })
          await store.write(captured)
          break
        case "clear": await store.clear(); await store.write(captured); break
        case "refresh": await store.write({ ...captured, accessToken: "rotated", refreshToken: "rotated" }); break
      }
      if (transition === "refresh") {
        expect(await account.isCurrent()).toBe(true)
        expect(await operation.pairing.listPending()).toEqual([])
        expect((await operation.keyring.sign({ purpose: "object-digest", digest: new Uint8Array(32) })).length).toBe(64)
        expect(sent).toEqual(["/v1/sync/pending"])
      } else {
        expect(await account.isCurrent()).toBe(false)
        expect(account.signal.aborted).toBe(true)
        expect(await operation.pairing.listPending().then(() => false, () => true)).toBe(true)
        expect(await operation.keyring.sign({ purpose: "object-digest", digest: new Uint8Array(32) }).then(() => false, () => true)).toBe(true)
        expect(sent).toEqual([])
      }
      await operation.close()
    })
  }
})
