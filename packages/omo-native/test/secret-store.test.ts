import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureSecretStore, secretFileName, secretStoreDir, writeSecret } from "../bin/lib/secret-store.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

function home(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-secret-store-"))
  roots.push(root)
  const dir = join(root, "home")
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("the secret store", () => {
  describe("#given a store that does not exist yet", () => {
    describe("#when a secret is written", () => {
      test("#then the directory is 0700 and the file is 0600", () => {
        const dir = secretStoreDir(home())

        const result = writeSecret(dir, "mcpServers.github.headers.Authorization", "Bearer s3cret")

        expect(result.ok).toBe(true)
        const path = (result as { path: string }).path
        expect(lstatSync(dir).mode & 0o777).toBe(0o700)
        expect(lstatSync(path).mode & 0o777).toBe(0o600)
      })

      test("#then the file holds the exact bytes, with no trailing newline", () => {
        const dir = secretStoreDir(home())

        const result = writeSecret(dir, "mcpServers.github.headers.Authorization", "Bearer s3cret")

        expect(readFileSync((result as { path: string }).path, "utf8")).toBe("Bearer s3cret")
      })

      test("#then the name comes from the field path, so it is not an oracle for the secret", () => {
        const dir = secretStoreDir(home())

        const result = writeSecret(dir, "mcpServers.github.headers.Authorization", "Bearer s3cret")

        expect((result as { path: string }).path).not.toContain("s3cret")
      })

      test("#then two different fields never land on the same file", () => {
        expect(secretFileName("mcpServers.a.env.headers.x")).not.toBe(secretFileName("mcpServers.a.env.headers.x".replace("a.env", "a")))
      })
    })
  })

  describe("#given the same field path written twice", () => {
    describe("#when the store is read", () => {
      test("#then there is one file, holding the newer value, and no backup copy", () => {
        const dir = secretStoreDir(home())

        writeSecret(dir, "mcpServers.github.headers.Authorization", "first")
        writeSecret(dir, "mcpServers.github.headers.Authorization", "second")

        const files = readdirSync(dir)
        expect(files).toHaveLength(1)
        expect(readFileSync(join(dir, files[0]), "utf8")).toBe("second")
      })
    })
  })

  describe("#given a store directory that is a symlink", () => {
    describe("#when a secret is written", () => {
      test("#then it is refused, because a secret must never be written through a symlink", () => {
        const base = home()
        const target = join(base, "elsewhere")
        mkdirSync(target, { recursive: true })
        const dir = secretStoreDir(base)
        mkdirSync(join(base, ".omo"), { recursive: true })
        symlinkSync(target, dir)

        const result = writeSecret(dir, "mcpServers.github.headers.Authorization", "Bearer s3cret")

        expect(result.ok).toBe(false)
        expect(readdirSync(target)).toEqual([])
      })
    })
  })

  describe("#given a store directory others can write to", () => {
    describe("#when a secret is written", () => {
      test("#then it is refused, because a writable directory is not a safe place for a secret", () => {
        const dir = secretStoreDir(home())
        ensureSecretStore(dir)
        chmodSync(dir, 0o770)

        const result = writeSecret(dir, "mcpServers.github.headers.Authorization", "Bearer s3cret")

        expect(result.ok).toBe(false)
        expect(existsSync(join(dir, secretFileName("mcpServers.github.headers.Authorization")))).toBe(false)
      })
    })
  })

  describe("#given a key path that tries to leave the store", () => {
    describe("#when a secret is written", () => {
      test("#then the secret still lands inside the store, because the name is a slug", () => {
        const dir = secretStoreDir(home())

        const result = writeSecret(dir, "../../escape", "Bearer s3cret")

        expect(result.ok).toBe(true)
        expect((result as { path: string }).path.startsWith(dir)).toBe(true)
        expect(readdirSync(dir)).toHaveLength(1)
      })
    })
  })
})
