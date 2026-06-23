import { describe, expect, test } from "bun:test"
import { checkBearerAuth } from "./auth"

describe("checkBearerAuth", () => {
  describe("#given missing authorization header", () => {
    test("#when no header sent #then rejects with missing_header", () => {
      const req = new Request("http://localhost/v1/models")
      const result = checkBearerAuth(req, "secret")
      expect(result).toEqual({ ok: false, reason: "missing_header" })
    })
  })

  describe("#given non-Bearer scheme", () => {
    test("#when header is Basic auth #then rejects with invalid_scheme", () => {
      const req = new Request("http://localhost/v1/models", {
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      })
      const result = checkBearerAuth(req, "secret")
      expect(result).toEqual({ ok: false, reason: "invalid_scheme" })
    })
  })

  describe("#given Bearer scheme with wrong token", () => {
    test("#when token mismatch #then rejects with invalid_token", () => {
      const req = new Request("http://localhost/v1/models", {
        headers: { authorization: "Bearer wrong" },
      })
      const result = checkBearerAuth(req, "secret")
      expect(result).toEqual({ ok: false, reason: "invalid_token" })
    })

    test("#when no token at all #then rejects with invalid_scheme", () => {
      const req = new Request("http://localhost/v1/models", {
        headers: { authorization: "Bearer" },
      })
      const result = checkBearerAuth(req, "secret")
      expect(result).toEqual({ ok: false, reason: "invalid_scheme" })
    })
  })

  describe("#given Bearer scheme with correct token", () => {
    test("#when exact match #then accepts", () => {
      const req = new Request("http://localhost/v1/models", {
        headers: { authorization: "Bearer secret" },
      })
      const result = checkBearerAuth(req, "secret")
      expect(result).toEqual({ ok: true })
    })

    test("#when token has length difference but otherwise matches #then rejects", () => {
      const req = new Request("http://localhost/v1/models", {
        headers: { authorization: "Bearer secret-extra" },
      })
      const result = checkBearerAuth(req, "secret")
      expect(result).toEqual({ ok: false, reason: "invalid_token" })
    })
  })
})
