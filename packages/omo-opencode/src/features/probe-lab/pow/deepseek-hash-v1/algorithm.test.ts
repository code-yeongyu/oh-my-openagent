import { describe, expect, test } from "bun:test"
import { solveDeepSeekHashV1 } from "./algorithm"
import { bytesEqual, hexToBytes } from "./bytes-codec"
import { dsHashV1, dsHashV1Hex } from "./hash"
import { solveDeepSeekHashV1ViaWasm, dsHashV1ViaWasm } from "./wasm-oracle"
import { buildPowResponseHeader, DEEPSEEK_POW_HEADER_NAME } from "./header-builder"
import { buildPrefix } from "./types"
import type { DsHashV1Challenge } from "./types"

const enc = new TextEncoder()

describe("dsHashV1 (Keccak[1600, rate=136, suffix=0x06, rounds=23, out=32])", () => {
  describe("#given known fips-202-equivalent inputs", () => {
    describe("#when hashing 'test' / empty / 'abc'", () => {
      test("#then output matches captured wasm oracle bytes", () => {
        expect(dsHashV1Hex(enc.encode("test"))).toBe("9335d95d1a5f0a0ca02ec2772fa2ca461969f1923032cb5781e05c10e4966d7c")
        expect(dsHashV1Hex(new Uint8Array(0))).toBe("e594808bc5b7151ac160c6d39a02e0a8e261ed588578403099e3561dc40c26b3")
        expect(dsHashV1Hex(enc.encode("abc"))).toBe("f841106c601ce9be9bc38525e90d4178d47f21dd8eb9f238fc55ffaa4ca94506")
      })
    })
  })

  describe("#given probes against wasm oracle", () => {
    describe("#when hashing 6 distinct inputs", () => {
      test("#then pure-ts output is bit-equal to wasm output", () => {
        const inputs: Uint8Array[] = [
          new Uint8Array(0),
          enc.encode("a"),
          enc.encode("test"),
          enc.encode("abc"),
          new Uint8Array(32),
          new Uint8Array(32).fill(0xff),
        ]
        for (const input of inputs) {
          expect(bytesEqual(dsHashV1(input), dsHashV1ViaWasm(input))).toBe(true)
        }
      })
    })
  })
})

describe("solveDeepSeekHashV1", () => {
  describe("#given a self-constructed challenge with a known nonce", () => {
    describe("#when solving", () => {
      test("#then the returned nonce equals the planted nonce", () => {
        const salt = "5f354fee5d6a540d5de2"
        const expireAt = 1778181967834
        const plantedNonce = 1234
        const prefix = buildPrefix(salt, expireAt)
        const targetBytes = dsHashV1(enc.encode(prefix + plantedNonce.toString()))
        const challenge: DsHashV1Challenge = {
          algorithm: "DeepSeekHashV1",
          challenge: Array.from(targetBytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
          salt,
          signature: "00".repeat(32),
          difficulty: 5000,
          expire_at: expireAt,
          expire_after: 300000,
          target_path: "/api/v0/chat/completion",
        }
        expect(solveDeepSeekHashV1(challenge).answer).toBe(plantedNonce)
      })
    })
  })

  describe("#given the captured deepseek live challenge", () => {
    describe("#when solving with pure-ts", () => {
      test("#then it matches the wasm oracle answer (nonce=69342)", () => {
        const challenge: DsHashV1Challenge = {
          algorithm: "DeepSeekHashV1",
          challenge: "9ed0cee4ea2a1e03a83e5eaf4c6b6a7028aa4348cf18bfa770d73ddc8b90f58e",
          salt: "5f354fee5d6a540d5de2",
          signature: "05351dc595fb9278e1d06386eecfa2b88f1a42cef5a87936379c0bbe71cde222",
          difficulty: 144000,
          expire_at: 1778181967834,
          expire_after: 300000,
          target_path: "/api/v0/chat/completion",
        }
        const ts = solveDeepSeekHashV1(challenge)
        const wasm = solveDeepSeekHashV1ViaWasm(challenge)
        expect(ts.answer).toBe(69342)
        expect(wasm.answer).toBe(69342)
      })
    })
  })

  describe("#given 5 random self-built challenges", () => {
    describe("#when solving with pure-ts and wasm in parallel", () => {
      test("#then both implementations yield bit-equal nonces", () => {
        const cases = [
          { salt: "0123456789abcdef0123", expireAt: 1700000000000, nonce: 17 },
          { salt: "fedcba9876543210fedc", expireAt: 1750000000001, nonce: 99 },
          { salt: "deadbeefcafebabe1234", expireAt: 1780000000123, nonce: 4321 },
          { salt: "5f354fee5d6a540d5de2", expireAt: 1778181967834, nonce: 8765 },
          { salt: "abcdef0123456789abcd", expireAt: 1799000000000, nonce: 12345 },
        ]
        for (const { salt, expireAt, nonce } of cases) {
          const targetBytes = dsHashV1(enc.encode(buildPrefix(salt, expireAt) + nonce.toString()))
          const ch: DsHashV1Challenge = {
            algorithm: "DeepSeekHashV1",
            challenge: Array.from(targetBytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
            salt,
            signature: "11".repeat(32),
            difficulty: nonce + 100,
            expire_at: expireAt,
            expire_after: 300000,
            target_path: "/api/v0/chat/completion",
          }
          expect(solveDeepSeekHashV1(ch).answer).toBe(nonce)
          expect(solveDeepSeekHashV1ViaWasm(ch).answer).toBe(nonce)
        }
      })
    })
  })

  describe("#given an unsupported algorithm", () => {
    describe("#when solving", () => {
      test("#then it throws", () => {
        const bad = { algorithm: "DeepSeekHashV2", challenge: "00".repeat(32), salt: "00".repeat(10), signature: "00".repeat(32), difficulty: 10, expire_at: 0, expire_after: 0, target_path: "/x" }
        expect(() => solveDeepSeekHashV1(bad as unknown as DsHashV1Challenge)).toThrow(/unsupported algorithm/)
      })
    })
  })
})

describe("buildPowResponseHeader", () => {
  describe("#given a solved challenge", () => {
    describe("#when building the header", () => {
      test("#then name is X-DS-PoW-Response and value is base64(JSON) with all 6 fields", () => {
        const challenge: DsHashV1Challenge = {
          algorithm: "DeepSeekHashV1",
          challenge: "ab".repeat(32),
          salt: "cd".repeat(10),
          signature: "ef".repeat(32),
          difficulty: 144000,
          expire_at: 1778181967834,
          expire_after: 300000,
          target_path: "/api/v0/chat/completion",
        }
        const header = buildPowResponseHeader({ challenge, answer: 12345 })
        expect(header.name).toBe(DEEPSEEK_POW_HEADER_NAME)
        const decoded = JSON.parse(Buffer.from(header.value, "base64").toString("utf8")) as Record<string, unknown>
        expect(decoded["algorithm"]).toBe("DeepSeekHashV1")
        expect(decoded["challenge"]).toBe(challenge.challenge)
        expect(decoded["salt"]).toBe(challenge.salt)
        expect(decoded["signature"]).toBe(challenge.signature)
        expect(decoded["answer"]).toBe(12345)
        expect(decoded["target_path"]).toBe(challenge.target_path)
      })
    })
  })
})

describe("hexToBytes / bytesToHex", () => {
  describe("#given a roundtrip", () => {
    describe("#when encoding then decoding 32 random bytes", () => {
      test("#then the roundtrip is bit-equal", () => {
        const input = new Uint8Array(32)
        for (let i = 0; i < 32; i++) input[i] = (i * 17 + 5) & 0xff
        const h = Array.from(input).map((b) => b.toString(16).padStart(2, "0")).join("")
        expect(bytesEqual(hexToBytes(h), input)).toBe(true)
      })
    })
  })
})
