import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { canonicalizeJson } from "../canonical-json.ts"
import { approvalCode, approvalCommitment, type PairingParty } from "./pairing.ts"

const party = (seed: number, nonceSeed: number): PairingParty => {
  const key = (offset: number) => Buffer.from(Array.from({ length: 32 }, (_, i) => (seed * 7 + i + offset) % 256)).toString("base64url")
  return { principal: { kind: "device", id: `d${seed}`, sealing_public_key: key(100), signing_public_key: key(0) }, nonce: Buffer.alloc(16, nonceSeed).toString("base64url") }
}

// An independent derivation straight from sync-design section 7 step 4 and 8.1's literal names,
// written without the module's helpers, so a drift in either side's framing fails here.
const referenceCode = (account: string, a: PairingParty, b: PairingParty): string => {
  const ordered = [a, b].sort((x, y) => Buffer.compare(Buffer.from(x.principal.signing_public_key, "base64url"), Buffer.from(y.principal.signing_public_key, "base64url")))
  const payload = canonicalizeJson({ account, devices: ordered.map((d) => ({ sealing_public_key: d.principal.sealing_public_key, signing_public_key: d.principal.signing_public_key, nonce: d.nonce })) })
  const digest = createHash("sha256").update(Buffer.concat([Buffer.from("omo-sync/v1/approval-code", "ascii"), Buffer.from([0]), Buffer.from(payload)])).digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0")
}

test("both devices compute the same code, and it is the section 7 construction", async () => {
  const joining = party(1, 5)
  const approver = party(200, 9)
  const code = await approvalCode("acct", [joining, approver])
  expect(await approvalCode("acct", [approver, joining])).toBe(code)
  expect(code).toBe(referenceCode("acct", joining, approver))
  expect(code).toMatch(/^\d{6}$/)
})

test("a substituted key or nonce changes the code; the commitment binds the joining device's keys and nonce", async () => {
  const joining = party(1, 5)
  const approver = party(200, 9)
  const code = await approvalCode("acct", [joining, approver])
  expect(await approvalCode("acct", [joining, party(201, 9)])).not.toBe(code)
  expect(await approvalCode("acct", [joining, { ...approver, nonce: Buffer.alloc(16, 10).toString("base64url") }])).not.toBe(code)
  const commitment = await approvalCommitment("acct", joining)
  const expected = createHash("sha256").update(Buffer.concat([Buffer.from("omo-sync/v1/approval-commitment", "ascii"), Buffer.from([0]), Buffer.from(canonicalizeJson({ account: "acct", sealing_public_key: joining.principal.sealing_public_key, signing_public_key: joining.principal.signing_public_key, nonce: joining.nonce }))])).digest("base64url")
  expect(commitment).toBe(expected)
  expect(await approvalCommitment("acct", { ...joining, nonce: approver.nonce })).not.toBe(commitment)
})
