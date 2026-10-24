import { expect, test } from "bun:test"
import { createPublicKey, verify } from "node:crypto"
import { credentialAuthoritySchema } from "../../omo-opencode/src/cli/service-auth/credential-authority"
import { generateDeviceKeys } from "../../omo-opencode/src/cli/service-auth/device-keys"
import capabilities from "../../omo-opencode/src/cli/service-auth/fixtures/refresh-writer-v1/messages.json"
import { createCredentialStore, createSealedStore, credentialId, InvalidCredentialState } from "../../omo-opencode/src/cli/service-auth/keystore"
import { revocationsSchema, type OwnedCredential } from "../../omo-opencode/src/cli/service-auth/protocol-v2"
import { createProtocol2Session } from "../../omo-opencode/src/cli/service-auth/session-v2"
import { enrollmentIntentSchema, enrollmentSigningBytes } from "../../omo-opencode/src/cli/service-auth/writer-protocol"
import { fakeApi, memorySecrets, refusal, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { runAccountVerb } from "../account-cli"

async function world() {
  const now = Date.parse("2030-01-02T03:04:00.000Z")
  const keys = generateDeviceKeys()
  const owner = { accountId: "account-A", deviceId: "device-A", familyId: "family-A", generation: 7, ownerHandle: "handle-A" }
  const legacyCredential = {
    ...keys.private, device: { id: owner.deviceId, name: "A" }, accessToken: "old-access", refreshToken: "source-A",
    accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
  }
  const A: OwnedCredential = {
    ...legacyCredential, owner: { ...owner, generation: 8 }, writerFloor: 2,
    accessToken: "access-A-8", refreshToken: "refresh-A-8", accessTokenExpiresAt: new Date(now + 3600_000).toISOString(),
  }
  const B: OwnedCredential = {
    ...A, ...generateDeviceKeys().private, owner: { ...owner, deviceId: "device-B", familyId: "family-B", generation: 1, ownerHandle: "handle-B" },
    device: { id: "device-B", name: "B" }, accessToken: "access-B-1", refreshToken: "refresh-B-1",
  }
  const calls: string[] = []
  const claimRequests: unknown[] = []
  let advertised = true
  let loseClaim = false
  let claimed = false
  let confirmed = false
  let refreshRefusal: string | undefined
  let currentA = A
  const api = fakeApi(async request => {
    const path = new URL(request.url).pathname
    calls.push(`${request.method} ${path}`)
    if (path === "/.well-known/omo-service") return Response.json(advertised ? { capabilities: capabilities.capabilities } : {})
    if (path === "/v1/session/writer-enrollment-challenges") {
      expect(await request.json()).toEqual({ version: 1, purpose: "refresh_writer_enrollment" })
      return Response.json({
        version: 1, purpose: "refresh_writer_enrollment", serviceOrigin: api,
        challengeNonce: Buffer.alloc(32).toString("base64url"), challengeExpiresAt: new Date(now + 60_000).toISOString(),
      })
    }
    if (path === "/v1/session/writer-enrollment-bootstrap") {
      const input = await request.json() as { intent: unknown; signature: string; refreshToken: string }
      const intent = enrollmentIntentSchema.parse(input.intent)
      expect(input.refreshToken).toBe(legacyCredential.refreshToken)
      expect(intent.deviceId).toBe(owner.deviceId)
      expect(verify(null, enrollmentSigningBytes(intent), createPublicKey({ key: {
        kty: "OKP", crv: "Ed25519", x: keys.public.signingKey,
      }, format: "jwk" }), Buffer.from(input.signature, "base64url"))).toBe(true)
      return Response.json({
        version: 1, outcome: "ready", owner, writerFloor: 1, enrollmentAuthorization: "authorization-A",
        enrollmentAuthorizationExpiresAt: new Date(now + 60_000).toISOString(),
      })
    }
    if (path === "/v1/session/writer-enrollments") {
      const body = await request.json()
      claimRequests.push(body)
      expect(body).toMatchObject({ version: 1, expectedFamilyId: owner.familyId, expectedGeneration: 7,
        refreshToken: legacyCredential.refreshToken, enrollmentAuthorization: "authorization-A" })
      if (claimed) expect(body).toEqual(claimRequests[0])
      const outcome = claimed ? "already_claimed" : "claimed"
      claimed = true
      if (loseClaim) { loseClaim = false; return new Response("lost answer", { status: 502 }) }
      return Response.json({ version: 1, outcome, credential: A })
    }
    if (path === "/v1/session/credential-adoptions") {
      const body = await request.json() as { adoptionId: string; action: string; expectedActiveOwner: unknown }
      expect(body).toMatchObject({ version: 1, freshAuthorizationProof: "proof-B",
        credential: { owner: B.owner, writerFloor: 2, refreshToken: B.refreshToken } })
      return Response.json({
        version: 1, outcome: "approved", adoptionId: body.adoptionId, action: body.action,
        owner: B.owner, writerFloor: 2, expectedActiveOwner: body.expectedActiveOwner,
      })
    }
    if (path === "/v1/session/refresh") {
      expect(request.headers.get("omo-refresh-writer-version")).toBe("2")
      expect(request.headers.get("idempotency-key")).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(await request.json()).toEqual({ refreshToken: currentA.refreshToken })
      if (refreshRefusal !== undefined) return refusal(refreshRefusal, undefined, 401)
      currentA = { ...currentA, owner: { ...currentA.owner, generation: currentA.owner.generation + 1 },
        accessToken: `access-A-${currentA.owner.generation + 1}`, refreshToken: `refresh-A-${currentA.owner.generation + 1}` }
      return Response.json(currentA)
    }
    if (path === "/v1/devices/device-A") {
      expect(request.headers.get("authorization")).toBe(`Bearer ${currentA.accessToken}`)
      return confirmed ? new Response(null, { status: 204 }) : refusal("unauthorized", undefined, 401)
    }
    return refusal("not_found", undefined, 404)
  })
  const secrets = memorySecrets()
  const legacy = createCredentialStore(api, secrets.api, "darwin")
  const state = createSealedStore(api, "omo-cli-v2", credentialAuthoritySchema, secrets.api, "darwin")
  const pending = createSealedStore(api, "omo-cli-revocations-v2", revocationsSchema, secrets.api, "darwin")
  await legacy.write(legacyCredential)
  const home = await temporaryHome()
  const session = () => createProtocol2Session({
    api, legacy, store: state, revocations: pending, home, now: () => now,
    clock: async () => ({ wallTimeMs: now, continuousTimeMs: 1000, bootId: "boot-A" }),
  })
  const run = async (verb: string, input?: unknown, flags: string[] = []) => {
    const output: unknown[] = []
    const exit = await runAccountVerb({
      api, store: legacy, protocol2: session(), home, pinDir: () => "", readStdin: async () => JSON.stringify(input),
      output: line => output.push(JSON.parse(line)), error: () => {},
    }, [verb, ...flags])
    return { exit, output }
  }
  return {
    run, state, pending, legacy, calls, claimRequests, A, B, now, legacyCredential,
    noCapabilities: () => { advertised = false }, loseClaim: () => { loseClaim = true }, confirm: () => { confirmed = true },
    refuseRefresh: (code: string) => { refreshRefusal = code },
    corruptPending: (value: unknown) => secrets.api.set({
      service: "omo-cli-revocations-v2", name: credentialId(api), value: JSON.stringify(value),
    }),
  }
}

test("account token enrolls through signed bootstrap and publishes the committed owner tuple", async () => {
  const w = await world()
  expect(await w.run("token")).toEqual({ exit: 0, output: [{
    accessToken: w.A.accessToken, accessTokenExpiresAt: w.A.accessTokenExpiresAt, device: w.A.device, owner: w.A.owner,
  }] })
  expect((await w.state.read())?.active).toMatchObject(w.A)
  expect(await w.legacy.read()).toBeNull()
})

test("old service is exit 5 service_upgrade_required with no v1 mutation or enrollment token send", async () => {
  const w = await world()
  w.noCapabilities()
  expect(await w.run("token")).toEqual({ exit: 5, output: [{ ended: { code: "service_upgrade_required" } }] })
  expect(await w.legacy.read()).toEqual(w.legacyCredential)
  expect(await w.state.read()).toBeNull()
  expect(w.calls).toEqual(["GET /.well-known/omo-service"])
})

test("lost claim returns exit 6 with the immutable deadline and restart repeats the original POST", async () => {
  const w = await world()
  w.loseClaim()
  expect(await w.run("token")).toEqual({ exit: 6, output: [{ uncertain: { deadline: new Date(w.now + 25_000).toISOString() } }] })
  expect((await w.state.read())?.active).toBeNull()
  expect((await w.run("token")).exit).toBe(0)
  expect(w.claimRequests).toHaveLength(2)
  expect(w.claimRequests[1]).toEqual(w.claimRequests[0])
  expect(w.calls.some(path => path.startsWith("GET /v1/session/writer-enrollments"))).toBe(false)
})

test.each(["unauthorized", "writer_floor_mismatch", "client_upgrade_required", "refresh_recovery_expired"])(
  "%s retains non-revoked ownership but permanently closes the attempt", async code => {
    const w = await world()
    await w.run("token")
    await w.state.write({ version: 2, active: { ...w.A, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" } })
    w.refuseRefresh(code)
    expect(await w.run("token")).toEqual({ exit: 5, output: [{ ended: { code } }] })
    expect((await w.state.read())?.active).toMatchObject({
      owner: w.A.owner, refreshToken: w.A.refreshToken, signingPrivateKey: w.A.signingPrivateKey,
      refreshAttempt: { state: "exhausted" },
    })
    expect(await w.run("token")).toEqual({ exit: 5, output: [{ ended: { code: "refresh_recovery_expired" } }] })
    expect(w.calls.filter(call => call === "POST /v1/session/refresh")).toHaveLength(1)
  },
)

test("real account verbs retain pending A, activate proof-authorized B, then refresh and settle only A", async () => {
  const w = await world()
  await w.run("token")
  const input = { version: 2, revocationId: "revoke-A", owner: w.A.owner }
  expect(await w.run("revoke-pending", input)).toEqual({ exit: 0, output: [{ revocation: {
    revocationId: "revoke-A", state: "pending", reason: "remote_unconfirmed", owner: w.A.owner,
  } }] })
  expect((await w.run("adopt", { ...w.B, freshAuthorizationProof: "proof-B" }, ["--replace"])).exit).toBe(0)
  const activeB = (await w.state.read())?.active
  const pending = await w.pending.read()
  if (pending === null) throw new Error("missing owned revocation")
  await w.pending.write({ ...pending, records: pending.records.map(record => record.state === "pending" ? {
    ...record, credential: { ...record.credential, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" },
  } : record) })
  w.confirm()

  const final = await w.run("revoke-pending", input)

  expect(final).toEqual({ exit: 0, output: [{ revocation: {
    revocationId: "revoke-A", state: "confirmed", owner: { ...w.A.owner, generation: 9 },
  } }] })
  expect((await w.state.read())?.active).toEqual(activeB)
  expect(await w.run("revoke-pending", input)).toEqual(final)
  expect((await w.run("token")).output).toEqual([{
    accessToken: w.B.accessToken, accessTokenExpiresAt: w.B.accessTokenExpiresAt, device: w.B.device, owner: w.B.owner,
  }])
})

test.each(["owner", "device", "generation", "tombstone", "duplicate-id", "duplicate-owner"] as const)(
  "%s custody corruption cannot send a revoke or clear active B", async corruption => {
  const w = await world()
  await w.state.write({ version: 2, active: w.B })
  const base = { revocationId: "revoke-A", state: "pending", originalOwner: w.A.owner, credential: w.A, recoveryExhausted: false }
  let records: unknown[]
  switch (corruption) {
    case "owner": records = [{ ...base, credential: w.B }]; break
    case "device": records = [{ ...base, credential: { ...w.A, device: w.B.device } }]; break
    case "generation": records = [{ ...base, credential: { ...w.A, owner: { ...w.A.owner, generation: 7 } } }]; break
    case "tombstone": records = [{
      revocationId: "revoke-A", state: "settled", originalOwner: w.A.owner,
      response: { revocation: { revocationId: "another-id", state: "confirmed", owner: w.A.owner } },
    }]; break
    case "duplicate-id": records = [base, { ...base, originalOwner: w.B.owner, credential: w.B }]; break
    case "duplicate-owner": records = [base, { ...base, revocationId: "another-id" }]; break
  }
  await w.corruptPending({ version: 2, records })
  await expect(w.pending.read()).rejects.toBeInstanceOf(InvalidCredentialState)
  const result = await w.run("revoke-pending", { version: 2, revocationId: "revoke-A", owner: w.A.owner })
  expect(result.exit).toBe(1)
  expect(w.calls).toHaveLength(0)
  expect((await w.state.read())?.active).toEqual(w.B)
})
