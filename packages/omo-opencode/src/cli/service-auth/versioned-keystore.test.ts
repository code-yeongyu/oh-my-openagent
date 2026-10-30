import { expect, test } from "bun:test"
import { z } from "zod"
import { createCredentialStore, createSealedStore, credentialId, KeychainApprovalPendingError, type SecretApi } from "./keystore"
import { grant, memorySecrets, privateKeys } from "./test-support"

test("legacy credential writers cannot read, overwrite or clear protocol-2 custody", async () => {
  const secrets = memorySecrets()
  const api = "https://api.example"
  const schema = z.object({ id: z.string(), cursor: z.number() })
  const active = createSealedStore(api, "omo-cli-v2", schema, secrets.api, "darwin")
  const pending = createSealedStore(api, "omo-cli-revocations-v2", schema, secrets.api, "darwin")
  await active.write({ id: "B", cursor: 8 })
  await pending.write({ id: "A", cursor: 7 })
  const legacy = createCredentialStore(api, { secrets: secrets.api, platform: "darwin" })

  await legacy.write({ ...grant, ...privateKeys })
  await legacy.clear()

  expect(await active.read()).toEqual({ id: "B", cursor: 8 })
  expect(await pending.read()).toEqual({ id: "A", cursor: 7 })
  expect([...secrets.values.keys()].sort()).toEqual([
    `omo-cli-revocations-v2:${credentialId(api)}`, `omo-cli-v2:${credentialId(api)}`,
  ])
})

test("protocol-2 credential and pending-revocation reads share only their own slot and hit the session deadline", async () => {
  const gets: string[] = []
  const secrets: SecretApi = {
    get: ({ service, name }) => {
      gets.push(`${service}:${name}`)
      return new Promise<string | null>(() => undefined)
    },
    set: async () => undefined,
    delete: async () => true,
  }
  const schema = z.object({ id: z.string() })
  const api = "https://api.example"
  const stores = (["omo-cli-v2", "omo-cli-revocations-v2"] as const).flatMap(namespace =>
    [api, `${api}/`].map(origin => createSealedStore(origin, namespace, schema, secrets, "darwin")),
  )

  const outcomes = await Promise.allSettled(stores.map(store => store.read()))

  for (const outcome of outcomes) {
    expect(outcome.status).toBe("rejected")
    if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(KeychainApprovalPendingError)
  }
  expect(gets.sort()).toEqual([
    `omo-cli-revocations-v2:${credentialId(api)}`, `omo-cli-v2:${credentialId(api)}`,
  ])
}, 8_000)

test("protocol-2 namespaces share canonical origin naming but isolate another origin", async () => {
  const secrets = memorySecrets()
  const schema = z.object({ id: z.string() })
  await createSealedStore("https://api.example/", "omo-cli-v2", schema, secrets.api, "darwin").write({ id: "A" })

  expect(await createSealedStore("https://api.example", "omo-cli-v2", schema, secrets.api, "darwin").read()).toEqual({ id: "A" })
  expect(await createSealedStore("https://other.example", "omo-cli-v2", schema, secrets.api, "darwin").read()).toBeNull()
})
