import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findSecretCandidates, secretBytesAreAmbiguous } from "../bin/lib/secret-detect.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-secret-detect-"))
  roots.push(root)
  mkdirSync(join(root, "home"), { recursive: true })
  return join(root, "home")
}

// A fake key, shaped like one so the detector's rules are exercised. Not a credential.
const SECRET = "sk-live-0123456789abcdefghij" // gitleaks:allow -- a test fixture, not a real key

function mcp(config: Record<string, unknown>) {
  return findSecretCandidates("mcp", [{ name: "github", config }])
}

function models(config: Record<string, unknown>) {
  return findSecretCandidates("models", [{ id: "acme", config }])
}

function auth(key: unknown) {
  return findSecretCandidates("auth", [{ provider: "acme", key }])
}

describe("finding the secrets in a config", () => {
  describe("#given an mcp server with a credential header", () => {
    describe("#when the secrets are looked for", () => {
      test("#then the header is found, with the field it was found in", () => {
        const found = mcp({ type: "http", url: "https://f.test/mcp", headers: { Authorization: `Bearer ${SECRET}` } })

        expect(found).toEqual([
          { kind: "mcp", id: "github", index: 0, path: ["headers", "Authorization"], value: `Bearer ${SECRET}`, reason: "credential header" },
        ])
      })
    })
  })

  describe("#given an mcp server with a credential environment variable", () => {
    describe("#when the secrets are looked for", () => {
      test("#then the variable is found", () => {
        const found = mcp({ type: "stdio", command: "tool", env: { API_TOKEN: SECRET } })

        expect(found).toHaveLength(1)
        expect(found[0].path).toEqual(["env", "API_TOKEN"])
      })
    })
  })

  describe("#given an mcp server with a token passed as an argument", () => {
    describe("#when the secrets are looked for", () => {
      test("#then the argument is found", () => {
        const found = mcp({ type: "stdio", command: "tool", args: ["--token", SECRET] })

        expect(found).toHaveLength(1)
        expect(found[0].path).toEqual(["args", 1])
      })
    })
  })

  describe("#given an mcp server with an ordinary header and an ordinary variable", () => {
    describe("#when the secrets are looked for", () => {
      test("#then neither is found", () => {
        const found = mcp({ type: "http", url: "https://f.test/mcp", headers: { Accept: "application/json" }, env: { PATH: "/usr/bin" } })

        expect(found).toEqual([])
      })
    })
  })

  describe("#given a provider with a credential header", () => {
    describe("#when the secrets are looked for", () => {
      test("#then the header is found", () => {
        const found = models({ baseUrl: "https://acme.test/v1", headers: { "X-Api-Key": SECRET } })

        expect(found).toEqual([
          { kind: "models", id: "acme", index: 0, path: ["headers", "X-Api-Key"], value: SECRET, reason: "credential header" },
        ])
      })
    })
  })

  describe("#given a provider api key", () => {
    describe("#when the secrets are looked for", () => {
      test("#then it is found, wherever it sits", () => {
        const found = models({ baseUrl: "https://acme.test/v1", apiKey: SECRET })

        expect(found).toHaveLength(1)
        expect(found[0].path).toEqual(["apiKey"])
      })
    })
  })

  describe("#given a credential in auth.json", () => {
    describe("#when the secrets are looked for", () => {
      test("#then it is found, because that field is always a credential", () => {
        const found = auth(SECRET)

        expect(found).toEqual([
          { kind: "auth", id: "acme", index: 0, path: ["key"], value: SECRET, reason: "credential key" },
        ])
      })
    })
  })

  describe("#given a value that is already a reference", () => {
    describe("#when the secrets are looked for", () => {
      test("#then it is left alone, because there is no secret in it to move", () => {
        const found = mcp({ type: "http", url: "https://f.test/mcp", headers: { Authorization: { $file: "~/k" } } })

        expect(found).toEqual([])
      })
    })
  })

  describe("#given a secret holding a $ or starting with !", () => {
    describe("#when the secrets are looked for", () => {
      test("#then it is found, and marked as bytes the engine would read as a template", () => {
        const found = mcp({ type: "http", url: "https://f.test/mcp", headers: { Authorization: "Bearer $TOKEN" } })

        expect(found).toHaveLength(1)
        expect(secretBytesAreAmbiguous(found[0].value)).toBe(true)
      })
    })
  })
})
