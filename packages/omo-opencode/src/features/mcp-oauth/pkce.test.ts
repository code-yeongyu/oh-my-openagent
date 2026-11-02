import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { generateCodeVerifier, generateCodeChallenge, buildAuthorizationUrl } from "./provider"

  describe("generateCodeVerifier", () => {
    it("returns a base64url-encoded 32-byte random string", () => {
      // given
      const verifier = generateCodeVerifier()

      // when
      const decoded = Buffer.from(verifier, "base64url")

      // then
      expect(decoded.length).toBe(32)
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("produces unique values on each call", () => {
      // given
      const first = generateCodeVerifier()

      // when
      const second = generateCodeVerifier()

      // then
      expect(first).not.toBe(second)
    })
  })

  describe("generateCodeChallenge", () => {
    it("returns SHA256 base64url digest of the verifier", () => {
      // given
      const verifier = "test-verifier-value"
      const expected = createHash("sha256").update(verifier).digest("base64url")

      // when
      const challenge = generateCodeChallenge(verifier)

      // then
      expect(challenge).toBe(expected)
    })
  })

  describe("buildAuthorizationUrl", () => {
    it("builds URL with all required PKCE parameters", () => {
      // given
      const endpoint = "https://auth.example.com/authorize"

      // when
      const url = buildAuthorizationUrl(endpoint, {
        clientId: "my-client",
        redirectUri: "http://127.0.0.1:8912/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
        scopes: ["openid", "profile"],
        resource: "https://mcp.example.com",
      })

      // then
      const parsed = new URL(url)
      expect(parsed.origin + parsed.pathname).toBe("https://auth.example.com/authorize")
      expect(parsed.searchParams.get("response_type")).toBe("code")
      expect(parsed.searchParams.get("client_id")).toBe("my-client")
      expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8912/callback")
      expect(parsed.searchParams.get("code_challenge")).toBe("challenge-value")
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
      expect(parsed.searchParams.get("state")).toBe("state-value")
      expect(parsed.searchParams.get("scope")).toBe("openid profile")
      expect(parsed.searchParams.get("resource")).toBe("https://mcp.example.com")
    })

    it("omits scope when empty", () => {
      // given
      const endpoint = "https://auth.example.com/authorize"

      // when
      const url = buildAuthorizationUrl(endpoint, {
        clientId: "my-client",
        redirectUri: "http://127.0.0.1:8912/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
        scopes: [],
      })

      // then
      const parsed = new URL(url)
      expect(parsed.searchParams.has("scope")).toBe(false)
    })

    it("omits resource when undefined", () => {
      // given
      const endpoint = "https://auth.example.com/authorize"

      // when
      const url = buildAuthorizationUrl(endpoint, {
        clientId: "my-client",
        redirectUri: "http://127.0.0.1:8912/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
      })

      // then
      const parsed = new URL(url)
      expect(parsed.searchParams.has("resource")).toBe(false)
    })
  })
