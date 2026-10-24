import { expect, test } from "bun:test"
import { createPrivateKey, sign } from "node:crypto"
import messages from "./fixtures/refresh-writer-v1/messages.json"
import rawIntent from "./fixtures/refresh-writer-v1/enrollment-intent.json"
import bootstrap from "./fixtures/refresh-writer-v1/bootstrap-request.json"
import vector from "./fixtures/refresh-writer-v1/signing-vector.json"
import { createWriterProtocol, enrollmentIntentSchema, enrollmentSigningBytes } from "./writer-protocol"
import { fakeApi, privateKeys } from "./test-support"
import { newRefreshAttempt } from "./refresh-attempt"

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(vector.seedHex, "hex")]),
  format: "der", type: "pkcs8",
})

test("the service's synthetic Ed25519 vector matches exact CLI signing bytes and signature", () => {
  const bytes = enrollmentSigningBytes(enrollmentIntentSchema.parse(rawIntent))
  expect(bytes.toString("hex")).toBe(vector.signingBytesHex)
  expect(sign(null, bytes, privateKey).toString("base64url")).toBe(vector.signature)
})

test.each(["serviceOrigin", "deviceId", "refreshTokenHash", "challengeNonce", "challengeExpiresAt", "enrollmentId", "idempotencyKey"] as const)(
  "the enrollment signature binds %s", field => {
    const original = enrollmentIntentSchema.parse(rawIntent)
    const changed = {
      ...original,
      [field]: field === "serviceOrigin" ? "https://other.example" :
        field === "refreshTokenHash" ? "0".repeat(64) :
        field === "challengeNonce" || field === "idempotencyKey" ? Buffer.alloc(32, 2).toString("base64url") :
        field === "challengeExpiresAt" ? "2030-01-02T03:04:06.000Z" : "other",
    }
    expect(sign(null, enrollmentSigningBytes(changed), privateKey).toString("base64url")).not.toBe(vector.signature)
  },
)

test("bootstrap sends the signed intent and claim sends the exact fixture field set", async () => {
  const now = Date.parse("2030-01-02T03:04:00.000Z")
  const calls: { path: string; body: unknown; writer: string | null }[] = []
  const api = fakeApi(async request => {
    const path = new URL(request.url).pathname
    if (request.method === "GET") return Response.json({ capabilities: messages.capabilities })
    calls.push({ path, body: await request.json(), writer: request.headers.get("omo-refresh-writer-version") })
    if (path.endsWith("challenges")) return Response.json({ ...messages.challengeResponse, serviceOrigin: api })
    if (path.endsWith("bootstrap")) return Response.json(messages.bootstrapReady)
    return Response.json(messages.enrollmentClaimed)
  })
  const wire = createWriterProtocol(api, undefined, () => now)
  const source = {
    ...privateKeys, signingPrivateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    device: { id: messages.bootstrapReady.owner.deviceId, name: "Fixture" },
    accessToken: "synthetic-old-access", accessTokenExpiresAt: new Date(now).toISOString(),
    refreshToken: bootstrap.refreshToken, refreshState: "uncertain" as const,
  }
  expect(await wire.enrollment.available()).toBe(true)
  const resolved = await wire.enrollment.bootstrap(source, rawIntent.enrollmentId, rawIntent.idempotencyKey)
  expect(resolved).toMatchObject({ result: "ready", owner: messages.bootstrapReady.owner })
  const signed = calls[1]?.body
  const expectedIntent = { ...enrollmentIntentSchema.parse(rawIntent), serviceOrigin: api }
  expect(signed).toEqual({
    ...bootstrap, intent: expectedIntent, signature: sign(null, enrollmentSigningBytes(expectedIntent), privateKey).toString("base64url"),
  })
  expect(await wire.enrollment.claim({
    state: "staged", enrollmentId: rawIntent.enrollmentId, authorization: messages.bootstrapReady.enrollmentAuthorization,
    original: source, owner: messages.bootstrapReady.owner,
    attempt: { ...newRefreshAttempt(api, messages.bootstrapReady.owner, source.refreshToken, {
      wallTimeMs: now, continuousTimeMs: 1000, bootId: "boot",
    }), idempotencyKey: rawIntent.idempotencyKey },
  })).toMatchObject({ result: "claimed", credential: messages.enrollmentClaimed.credential })
  expect(calls[2]?.body).toEqual(messages.enrollmentRequest)
  expect(calls.every(call => call.writer === "2")).toBe(true)
  expect(calls.some(call => call.path.includes("/refresh"))).toBe(false)
})

test.each([undefined, {}, { refreshWriterProtocols: [2] }, { ...messages.capabilities, refreshWriterBootstrap: "older" }])(
  "absent or malformed enrollment capability never implies support", async capabilities => {
    const api = fakeApi(() => Response.json({ capabilities }))
    expect(await createWriterProtocol(api).enrollment.available()).toBe(false)
  },
)
