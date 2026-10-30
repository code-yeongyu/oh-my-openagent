import { expect, test } from "bun:test"
import type { CredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import { grant, privateKeys, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { runAccountVerb } from "../account-cli"

test("account token never labels a captured token with a later credential read", async () => {
  const A = { ...grant, ...privateKeys }
  const B = { ...A, accessToken: "access-B", device: { id: "device-B", name: "B" } }
  let reads = 0
  const store: CredentialStore = {
    // A is the preflight and locked read; the next independently captured snapshot is B.
    read: async () => ++reads <= 2 ? A : B,
    write: async () => { throw new Error("cached access must not write") },
    clear: async () => { throw new Error("cached access must not clear") },
  }
  const replies: unknown[] = []
  const result = await runAccountVerb({
    api: "https://synthetic.example", store, home: await temporaryHome(), pinDir: () => "",
    readStdin: async () => "", output: line => replies.push(JSON.parse(line)), error: () => {},
  }, ["token"])

  expect(result).toBe(0)
  expect(replies).toEqual([{ accessToken: A.accessToken, accessTokenExpiresAt: A.accessTokenExpiresAt, device: A.device }])
  expect(reads).toBe(1)
})
