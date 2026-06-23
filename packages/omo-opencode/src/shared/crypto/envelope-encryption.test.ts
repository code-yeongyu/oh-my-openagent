/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { randomBytes } from "node:crypto"
import {
  decryptEnvelope,
  encryptEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type EncryptedEnvelope,
} from "./envelope-encryption"

const KEY = randomBytes(32)

describe("envelopeEncryption", () => {
  describe("#given a 32-byte master key and arbitrary plaintext", () => {
    describe("#when encrypting then decrypting", () => {
      it("should round-trip exactly", () => {
        const plaintext = '{"bearer_token":"tok-abc","scope":"all"}'
        const env = encryptEnvelope(plaintext, KEY, "v1")
        expect(env.alg).toBe("aes-256-gcm")
        expect(env.key_id).toBe("v1")
        expect(decryptEnvelope(env, KEY)).toBe(plaintext)
      })

      it("should not include plaintext in ciphertext field", () => {
        const env = encryptEnvelope("supersecret-token", KEY, "v1")
        expect(env.ciphertext).not.toContain("supersecret-token")
      })

      it("should produce different IV per call", () => {
        const a = encryptEnvelope("abc", KEY, "v1")
        const b = encryptEnvelope("abc", KEY, "v1")
        expect(a.iv).not.toBe(b.iv)
        expect(a.ciphertext).not.toBe(b.ciphertext)
      })
    })
  })

  describe("#given a tampered ciphertext", () => {
    describe("#when decrypting", () => {
      it("should throw envelope_decrypt_failed", () => {
        const env = encryptEnvelope("hello", KEY, "v1")
        const tampered: EncryptedEnvelope = {
          ...env,
          ciphertext: Buffer.from("garbage").toString("base64"),
        }
        expect(() => decryptEnvelope(tampered, KEY)).toThrow(/envelope_decrypt_failed/)
      })
    })
  })

  describe("#given a tampered auth_tag", () => {
    describe("#when decrypting", () => {
      it("should throw envelope_decrypt_failed", () => {
        const env = encryptEnvelope("hello", KEY, "v1")
        const tampered: EncryptedEnvelope = {
          ...env,
          auth_tag: Buffer.alloc(16, 0).toString("base64"),
        }
        expect(() => decryptEnvelope(tampered, KEY)).toThrow(/envelope_decrypt_failed/)
      })
    })
  })

  describe("#given the wrong master key", () => {
    describe("#when decrypting an envelope sealed with a different key", () => {
      it("should throw envelope_decrypt_failed", () => {
        const env = encryptEnvelope("hello", KEY, "v1")
        const otherKey = randomBytes(32)
        expect(() => decryptEnvelope(env, otherKey)).toThrow(/envelope_decrypt_failed/)
      })
    })
  })

  describe("#given an envelope with unsupported alg", () => {
    describe("#when decrypting", () => {
      it("should throw envelope_decrypt_failed: unsupported alg", () => {
        const env = encryptEnvelope("hello", KEY, "v1")
        const wrong = { ...env, alg: "chacha20" } as unknown as EncryptedEnvelope
        expect(() => decryptEnvelope(wrong, KEY)).toThrow(/unsupported alg/)
      })
    })
  })

  describe("#given a master key not 32 bytes", () => {
    describe("#when encrypting", () => {
      it("should throw envelope_invalid_master_key", () => {
        const short = randomBytes(16)
        expect(() => encryptEnvelope("x", short, "v1")).toThrow(/envelope_invalid_master_key/)
      })
    })
  })

  describe("#given serialize and parse round-trip", () => {
    describe("#when serializing then parsing", () => {
      it("should produce equal envelope", () => {
        const env = encryptEnvelope("text", KEY, "v1")
        const json = serializeEnvelope(env)
        expect(parseEnvelope(json)).toEqual(env)
      })
    })
  })

  describe("#given malformed JSON", () => {
    describe("#when parsing", () => {
      it("should throw envelope_parse_failed", () => {
        expect(() => parseEnvelope("{not-json")).toThrow(/envelope_parse_failed/)
      })
    })
  })

  describe("#given JSON missing required fields", () => {
    describe("#when parsing", () => {
      it("should throw envelope_parse_failed for missing ciphertext", () => {
        const broken = JSON.stringify({ key_id: "v1", alg: "aes-256-gcm", iv: "x", auth_tag: "y" })
        expect(() => parseEnvelope(broken)).toThrow(/missing or invalid field ciphertext/)
      })
    })
  })

  describe("#given JSON with wrong alg", () => {
    describe("#when parsing", () => {
      it("should throw envelope_parse_failed for unsupported alg", () => {
        const broken = JSON.stringify({
          key_id: "v1",
          alg: "rc4",
          iv: "x",
          auth_tag: "y",
          ciphertext: "z",
        })
        expect(() => parseEnvelope(broken)).toThrow(/unsupported alg/)
      })
    })
  })
})
