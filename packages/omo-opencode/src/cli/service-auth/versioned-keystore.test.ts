import { expect, test } from "bun:test"
import { z } from "zod"
import { createCredentialStore, createSealedStore, credentialId } from "./keystore"
import { grant, memorySecrets, privateKeys } from "./test-support"

test("legacy credential writers cannot read, overwrite or clear protocol-2 custody", async () => {
  const secrets = memorySecrets()
  const api = "https://api.example"
  const schema = z.object({ id: z.string(), cursor: z.number() })
  const active = createSealedStore(api, "omo-cli-v2", schema, secrets.api, "darwin")
  const pending = createSealedStore(api, "omo-cli-revocations-v2", schema, secrets.api, "darwin")
  await active.write({ id: "B", cursor: 8 })
  await pending.write({ id: "A", cursor: 7 })
  const legacy = createCredentialStore(api, secrets.api, "darwin")

  await legacy.write({ ...grant, ...privateKeys })
  await legacy.clear()

  expect(await active.read()).toEqual({ id: "B", cursor: 8 })
  expect(await pending.read()).toEqual({ id: "A", cursor: 7 })
  expect([...secrets.values.keys()].sort()).toEqual([
    `omo-cli-revocations-v2:${credentialId(api)}`, `omo-cli-v2:${credentialId(api)}`,
  ])
})

test("protocol-2 namespaces share canonical origin naming but isolate another origin", async () => {
  const secrets = memorySecrets()
  const schema = z.object({ id: z.string() })
  await createSealedStore("https://api.example/", "omo-cli-v2", schema, secrets.api, "darwin").write({ id: "A" })

  expect(await createSealedStore("https://api.example", "omo-cli-v2", schema, secrets.api, "darwin").read()).toEqual({ id: "A" })
  expect(await createSealedStore("https://other.example", "omo-cli-v2", schema, secrets.api, "darwin").read()).toBeNull()
})
