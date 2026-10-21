import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extractSecrets } from "../bin/lib/secret-extract.js"
import { secretStoreDir } from "../bin/lib/secret-store.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

function storeDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-secret-extract-"))
  roots.push(root)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  return secretStoreDir(home)
}

// A fake key, shaped like one so the detector's rules are exercised. Not a credential.
const SECRET = "sk-live-0123456789abcdefghij" // gitleaks:allow -- a test fixture, not a real key

describe("moving a secret out of a config", () => {
  describe("#given an mcp server with a credential header", () => {
    describe("#when the secrets are moved", () => {
      test("#then the config holds a reference and the bytes are in the store", () => {
        const dir = storeDir()
        const values = [{ name: "github", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: `Bearer ${SECRET}` } } }]

        const result = extractSecrets("mcp", values, { storeDir: dir })

        const reference = (result.values[0].config as any).headers.Authorization
        expect(reference.$file).toBeTypeOf("string")
        expect(readFileSync(reference.$file, "utf8")).toBe(`Bearer ${SECRET}`)
        expect(result.extracted).toHaveLength(1)
        expect(result.refused).toEqual([])
      })

      test("#then the store holds one file, and no copy of the secret is left in the config", () => {
        const dir = storeDir()
        const values = [{ name: "github", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: `Bearer ${SECRET}` } } }]

        const result = extractSecrets("mcp", values, { storeDir: dir })

        expect(readdirSync(dir)).toHaveLength(1)
        expect(JSON.stringify(result.values)).not.toContain(SECRET)
      })
    })
  })

  describe("#given a credential in auth.json", () => {
    describe("#when the secrets are moved", () => {
      test("#then the key becomes a reference and the bytes are in the store", () => {
        const dir = storeDir()
        const values = [{ provider: "acme", key: SECRET }]

        const result = extractSecrets("auth", values, { storeDir: dir })

        const reference = (result.values[0] as any).key
        expect(reference.$file).toBeTypeOf("string")
        expect(readFileSync(reference.$file, "utf8")).toBe(SECRET)
      })
    })
  })

  describe("#given a secret holding a $", () => {
    describe("#when the secrets are moved", () => {
      test("#then it is refused, and left where the user wrote it", () => {
        const dir = storeDir()
        const values = [{ name: "github", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "Bearer $TOKEN" } } }]

        const result = extractSecrets("mcp", values, { storeDir: dir })

        expect((result.values[0].config as any).headers.Authorization).toBe("Bearer $TOKEN")
        expect(result.extracted).toEqual([])
        expect(result.refused).toHaveLength(1)
        expect(result.refused[0].reason).toContain("$")
      })
    })
  })

  describe("#given a value that is already a reference", () => {
    describe("#when the secrets are moved", () => {
      test("#then it is left alone", () => {
        const dir = storeDir()
        const values = [{ name: "github", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: { $file: "~/k" } } } }]

        const result = extractSecrets("mcp", values, { storeDir: dir })

        expect((result.values[0].config as any).headers.Authorization).toEqual({ $file: "~/k" })
        expect(result.extracted).toEqual([])
        expect(existsSync(dir)).toBe(false)
      })
    })
  })

  describe("#given two fields whose names could be confused", () => {
    describe("#when the secrets are moved", () => {
      test("#then they land on two different files, and each keeps its own bytes", () => {
        const dir = storeDir()
        // Joined with a dot, these two would spell the same name.
        const values = [
          { name: "a.env", config: { type: "http", url: "https://f.test/mcp", env: { "API_TOKEN": "first-secret-value" } } },
          { name: "a", config: { type: "http", url: "https://f.test/mcp", env: { "env.API_TOKEN": "second-secret-value" } } },
        ]

        const result = extractSecrets("mcp", values, { storeDir: dir })

        const files = readdirSync(dir)
        expect(files).toHaveLength(2)
        const first = (result.values[0].config as any).env["API_TOKEN"]
        const second = (result.values[1].config as any).env["env.API_TOKEN"]
        expect(readFileSync(first.$file, "utf8")).toBe("first-secret-value")
        expect(readFileSync(second.$file, "utf8")).toBe("second-secret-value")
      })
    })
  })

  describe("#given two servers that share a name", () => {
    describe("#when the secrets are moved", () => {
      test("#then each keeps its own bytes, because the finding names the item it came from", () => {
        const dir = storeDir()
        const values = [
          { name: "same", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "first-secret-value" } } },
          { name: "same", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "second-secret-value" } } },
        ]

        const result = extractSecrets("mcp", values, { storeDir: dir })

        const first = (result.values[0].config as any).headers.Authorization
        const second = (result.values[1].config as any).headers.Authorization
        expect(readFileSync(first.$file, "utf8")).toBe("first-secret-value")
        expect(readFileSync(second.$file, "utf8")).toBe("second-secret-value")
      })
    })
  })

  describe("#given the values the caller passed in", () => {
    describe("#when the secrets are moved", () => {
      test("#then they are not changed under the caller", () => {
        const dir = storeDir()
        const values = [{ name: "github", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: SECRET } } }]

        extractSecrets("mcp", values, { storeDir: dir })

        expect((values[0].config as any).headers.Authorization).toBe(SECRET)
      })
    })
  })

  describe("#given a store that cannot be written", () => {
    describe("#when the secrets are moved", () => {
      test("#then the value is left where it was and the refusal says why", () => {
        const dir = storeDir()
        const values = [{ name: "github", config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: SECRET } } }]

        // a store under a regular file can never be created
        mkdirSync(dir, { recursive: true })
        const blocker = join(dir, "blocker")
        writeFileSync(blocker, "not a directory")
        const result = extractSecrets("mcp", values, { storeDir: join(blocker, "secrets") })

        expect((result.values[0].config as any).headers.Authorization).toBe(SECRET)
        expect(result.extracted).toEqual([])
        expect(result.refused).toHaveLength(1)
        expect(result.refused[0].reason).toBeTypeOf("string")
      })
    })
  })
})
