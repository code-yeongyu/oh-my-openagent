/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { attachPowResponseHeader, defaultFetchPowChallenge, isPowProtectedTarget } from "./deepseek-web-pow-handler"
import type { DsHashV1Challenge } from "../pow/deepseek-hash-v1/types"
import { dsHashV1 } from "../pow/deepseek-hash-v1/hash"
import { bytesToHex } from "../pow/deepseek-hash-v1/bytes-codec"
import { buildPrefix } from "../pow/deepseek-hash-v1/types"

const enc = new TextEncoder()

async function withMockFetch<T>(response: Response, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  const mockFetch: typeof fetch = Object.assign(async () => response, { preconnect: originalFetch.preconnect })
  globalThis.fetch = mockFetch
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function challengeForNonce(nonce: number): DsHashV1Challenge {
  const salt = "5f354fee5d6a540d5de2"
  const expireAt = 1778181967834
  const targetBytes = dsHashV1(enc.encode(buildPrefix(salt, expireAt) + nonce.toString()))
  return {
    algorithm: "DeepSeekHashV1",
    challenge: bytesToHex(targetBytes),
    salt,
    signature: "ab".repeat(32),
    difficulty: nonce + 100,
    expire_at: expireAt,
    expire_after: 300000,
    target_path: "/api/v0/chat/completion",
  }
}

describe("isPowProtectedTarget", () => {
  describe("#given various URLs", () => {
    test("#then only PoW-protected paths (chat/completion, file/upload_file) return true", () => {
      expect(isPowProtectedTarget("https://chat.deepseek.com/api/v0/chat/completion")).toBe(true)
      expect(isPowProtectedTarget("https://chat.deepseek.com/api/v0/file/upload_file")).toBe(true)
      expect(isPowProtectedTarget("https://chat.deepseek.com/api/v0/chat/regenerate")).toBe(false)
      expect(isPowProtectedTarget("https://chat.deepseek.com/api/v0/users/login")).toBe(false)
      expect(isPowProtectedTarget("/api/v0/chat/completion")).toBe(true)
      expect(isPowProtectedTarget("/api/v0/file/upload_file")).toBe(true)
      expect(isPowProtectedTarget("/api/v0/file/fetch_files")).toBe(false)
    })
  })
})

describe("attachPowResponseHeader", () => {
  describe("#given a fetchChallenge stub returning a known challenge", () => {
    describe("#when attaching the header", () => {
      test("#then the result contains X-DS-PoW-Response with base64(JSON({algorithm,challenge,salt,answer,signature,target_path}))", async () => {
        const challenge = challengeForNonce(7)
        const captured: { base_url: string; target_path: string }[] = []
        const fetcher = async (input: { base_url: string; target_path: string; headers: Record<string, string> }) => {
          captured.push({ base_url: input.base_url, target_path: input.target_path })
          return { challenge, cookies: "" }
        }
        const headers = await attachPowResponseHeader({
          base_url: "https://chat.deepseek.com",
          request_url: "https://chat.deepseek.com/api/v0/chat/completion",
          request_headers: { Authorization: "Bearer xxx", "Content-Type": "application/json" },
          fetchChallenge: fetcher,
        })
        expect(captured[0]?.base_url).toBe("https://chat.deepseek.com")
        expect(captured[0]?.target_path).toBe("/api/v0/chat/completion")
        expect(headers["Authorization"]).toBe("Bearer xxx")
        expect(headers["X-DS-PoW-Response"]).toBeTruthy()
        const decoded = JSON.parse(Buffer.from(headers["X-DS-PoW-Response"]!, "base64").toString("utf8")) as Record<string, unknown>
        expect(decoded["algorithm"]).toBe("DeepSeekHashV1")
        expect(decoded["challenge"]).toBe(challenge.challenge)
        expect(decoded["salt"]).toBe(challenge.salt)
        expect(decoded["signature"]).toBe(challenge.signature)
        expect(decoded["answer"]).toBe(7)
        expect(decoded["target_path"]).toBe("/api/v0/chat/completion")
      })
    })
  })

  describe("#given a relative URL request", () => {
    describe("#when attaching the header", () => {
      test("#then target_path is taken from the relative path", async () => {
        const challenge = challengeForNonce(11)
        const captured: { target_path: string }[] = []
        await attachPowResponseHeader({
          base_url: "https://chat.deepseek.com",
          request_url: "/api/v0/chat/completion",
          request_headers: {},
          fetchChallenge: async (input) => { captured.push({ target_path: input.target_path }); return { challenge, cookies: "" } },
        })
        expect(captured[0]?.target_path).toBe("/api/v0/chat/completion")
      })
    })
  })

  describe("#given captured cookies are empty", () => {
    test("#then existing Cookie header is preserved", async () => {
      const challenge = challengeForNonce(13)
      const headers = await attachPowResponseHeader({
        base_url: "https://chat.deepseek.com",
        request_url: "https://chat.deepseek.com/api/v0/chat/completion",
        request_headers: { Cookie: "aws-waf-token=waf-abc; ds_session=xyz" },
        fetchChallenge: async () => ({ challenge, cookies: "" }),
      })
      expect(headers.Cookie).toBe("aws-waf-token=waf-abc; ds_session=xyz")
    })
  })
})

describe("defaultFetchPowChallenge", () => {
  describe("#given a response with multiple Set-Cookie headers", () => {
    test("#then cookies are captured as name=value pairs only", async () => {
      const challenge = challengeForNonce(17)
      await withMockFetch(new Response(JSON.stringify({ challenge }), {
        status: 200,
        headers: new Headers([
          ["content-type", "application/json"],
          ["set-cookie", "ds_session_id=abc123; Path=/; HttpOnly; Secure; SameSite=Lax"],
          ["set-cookie", "feature_flag=on; Domain=deepseek.com; Path=/"],
        ]),
      }), async () => {
        const result = (await defaultFetchPowChallenge()({ base_url: "https://chat.deepseek.com", target_path: "/api/v0/chat/completion", headers: {} })) as unknown as { challenge: DsHashV1Challenge; cookies: string }
        expect(result.challenge.challenge).toBe(challenge.challenge)
        expect(result.cookies).toBe("ds_session_id=abc123; feature_flag=on")
      })
    })
  })

  describe("#given a response without Set-Cookie headers", () => {
    test("#then cookies is empty", async () => {
      const challenge = challengeForNonce(19)
      await withMockFetch(new Response(JSON.stringify({ challenge }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }), async () => {
        const result = (await defaultFetchPowChallenge()({ base_url: "https://chat.deepseek.com", target_path: "/api/v0/chat/completion", headers: {} })) as unknown as { challenge: DsHashV1Challenge; cookies: string }
        expect(result.cookies).toBe("")
      })
    })
  })
})
