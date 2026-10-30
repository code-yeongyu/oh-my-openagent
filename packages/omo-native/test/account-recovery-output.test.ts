import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { CredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import { RecoveryExhausted, RecoveryPending } from "../../omo-opencode/src/cli/service-auth/owned-refresh"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"

const expired = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }

test.each(["500", "timeout", "bad-json"])("a keyless legacy lost answer (%s) immediately exits 5 with terminal JSON", async failure => {
  const api = fakeApi(request => {
    expect(request.headers.get("idempotency-key")).toBeNull()
    return failure === "500" ? refusal("internal", undefined, 500) : new Response("{")
  })
  const fetcher = spyOn(globalThis, "fetch")
  if (failure === "timeout") fetcher.mockRejectedValueOnce(Object.assign(new Error("synthetic timeout"), { code: "ETIMEDOUT" }))
  onTestFinished(() => fetcher.mockRestore())
  const store = memorySecrets().store(api)
  await store.write(expired)
  const output: unknown[] = []
  const dependencies = {
    api, store, home: await temporaryHome(), pinDir: () => "", readStdin: async () => "",
    output: (line: string) => output.push(JSON.parse(line)), error: () => {},
  }

  expect(await runAccountVerb(dependencies, ["token"])).toBe(ACCOUNT_EXIT.ended)
  expect(output).toEqual([{ ended: { code: "refresh_recovery_expired" } }])
  expect(await store.read()).toEqual({ ...expired, refreshState: "uncertain" })
  expect(await runAccountVerb(dependencies, ["token"])).toBe(ACCOUNT_EXIT.ended)
  expect(output).toEqual(Array.from({ length: 2 }, () => ({ ended: { code: "refresh_recovery_expired" } })))
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test.each([
  { error: new RecoveryExhausted(), exit: 5, body: { ended: { code: "refresh_recovery_expired" } } },
  { error: new RecoveryPending(Date.parse("2030-01-01T00:00:25Z")), exit: 6, body: { uncertain: { deadline: "2030-01-01T00:00:25.000Z" } } },
])("account token maps $error to exit $exit and its exact JSON without rereading", async outcome => {
  let reads = 0
  const store: CredentialStore = {
    read: async () => { reads++; throw outcome.error },
    write: async () => { throw new Error("unexpected write") },
    clear: async () => { throw new Error("unexpected clear") },
  }
  const output: unknown[] = []
  const exit = await runAccountVerb({
    api: "https://synthetic.example", store, home: await temporaryHome(), pinDir: () => "",
    readStdin: async () => "", output: line => output.push(JSON.parse(line)), error: () => {},
  }, ["token"])
  expect(exit).toBe(outcome.exit)
  expect(output).toEqual([outcome.body])
  expect(reads).toBe(1)
})

test("adopt strips local recovery markers but preserves service owner and fresh-authorization input", async () => {
  const store = memorySecrets().store("https://synthetic.example")
  const incoming = {
    ...grant, ...privateKeys, refreshState: "uncertain", refreshAttempt: { idempotencyKey: "stray-journal" },
    owner: { accountId: "account", deviceId: grant.device.id, familyId: "family", generation: 1, ownerHandle: "opaque-owner" },
    freshAuthorizationProof: "synthetic-fresh-proof",
  }
  const exit = await runAccountVerb({
    api: "https://synthetic.example", store, home: await temporaryHome(), pinDir: () => "",
    readStdin: async () => JSON.stringify(incoming), output: () => {}, error: () => {},
  }, ["adopt"])
  expect(exit).toBe(ACCOUNT_EXIT.ok)
  expect(await store.read()).toEqual({
    ...grant, ...privateKeys, owner: incoming.owner, freshAuthorizationProof: incoming.freshAuthorizationProof,
  })
})
