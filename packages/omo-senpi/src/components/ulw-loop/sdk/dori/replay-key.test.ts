import { expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { inboundReplayKey, TOOLKIT_REPLAY_RETENTION_MS, toolkitReplayKey } from "./replay-key"

// dori-link derives envelope_id = UUIDv5(NAMESPACE, canonical key), with
// NAMESPACE = UUIDv5(6ba7b810-9dad-11d1-80b4-00c04fd430c8, "urn:dori-link:v1:envelope-id").
// omo ships no UUIDv5; this RFC 4122 reference pins the vectors the other side must reproduce.
function uuidv5(name: string, namespace: string): string {
  const digest = createHash("sha1").update(Buffer.concat([Buffer.from(namespace.replaceAll("-", ""), "hex"), Buffer.from(name, "utf8")])).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

test("#given the RFC 4122 reference #when it hashes a published vector #then it reproduces it", () => {
  expect(uuidv5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d")
})

test("#given a turn and a call index #when the canonical key is formed #then it is the JSON array string both sides agree on", () => {
  expect(toolkitReplayKey("dur-caller:a1b2c3d4", 0)).toBe('["turn","dur-caller:a1b2c3d4",0]')
  expect(toolkitReplayKey("dur-caller:a1b2c3d4", 7)).toBe('["turn","dur-caller:a1b2c3d4",7]')
  expect(toolkitReplayKey('a"b\\c', 1)).toBe(JSON.stringify(["turn", 'a"b\\c', 1]))
  expect(inboundReplayKey("telegram:42:1001")).toBe('["inbound","telegram:42:1001"]')
})

test("#given the fixed vectors #when dori-link derives envelope ids #then the ids are pinned", () => {
  const namespace = uuidv5("urn:dori-link:v1:envelope-id", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")
  expect(namespace).toBe("22c73091-04d2-539e-9fde-98a5eb7f484b")
  expect(uuidv5(toolkitReplayKey("dur-caller:a1b2c3d4", 0), namespace)).toBe("e40fb1fe-a22b-51c8-8237-fde018ae755c")
  expect(uuidv5(toolkitReplayKey("dur-caller:a1b2c3d4", 7), namespace)).toBe("65567098-fea4-5b2d-8a5b-c31425c0046c")
  expect(uuidv5(inboundReplayKey("telegram:42:1001"), namespace)).toBe("d905b43a-ecc1-5095-9fa1-c2eb72848208")
})

test("#given invalid parts #when a key is formed #then it throws instead of producing a key", () => {
  for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => toolkitReplayKey("t", index)).toThrow(TypeError)
  expect(() => toolkitReplayKey("", 0)).toThrow(TypeError)
  expect(() => inboundReplayKey("")).toThrow(TypeError)
})

test("#given the retention contract #when read #then keys are kept seven days", () => {
  expect(TOOLKIT_REPLAY_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000)
})
