import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readAuthStore, writeAuthStore } from "../bin/lib/auth-store.js"
import {
  decryptAuthStore,
  encryptAuthStore,
  resolveAuthAtRestMode,
  type AuthAtRestMode,
} from "../bin/lib/auth-store-encryption.ts"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

function fixture(): { root: string; home: string; sshDir: string; authPath: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-auth-rest-"))
  roots.push(root)
  const home = join(root, "home")
  const sshDir = join(home, ".ssh")
  mkdirSync(sshDir, { recursive: true })
  const authDir = join(root, "agent")
  mkdirSync(authDir, { recursive: true })
  return { root, home, sshDir, authPath: join(authDir, "auth.json") }
}

function writeSshFixture(sshDir: string, name = "id_ed25519"): string {
  // Conventional ed25519 fixture; the encryption module only needs the raw private-key bytes
  // for HKDF-style derivation, so any ssh-key-shaped payload is sufficient.
  const keyPath = join(sshDir, name)
  writeFileSync(keyPath, "openssh-key-v1\0ed25519-fixture-64-bytes-of-private-key-payload-data-padding")
  chmodSync(keyPath, 0o600)
  return keyPath
}

describe("auth.json at-rest encryption (PR-E)", () => {
  describe("#given mode is plain (the default)", () => {
    describe("#when writeAuthStore is called", () => {
      test("#then auth.json is written as plaintext json with mode 0600 and round-trips through readAuthStore", () => {
        const item = fixture()

        writeAuthStore(item.authPath, { entries: {}, bytes: undefined }, [
          { provider: "anthropic", key: "sk-plain" },
        ], { mode: "plain" })

        const text = readFileSync(item.authPath, "utf8")
        expect(JSON.parse(text)).toEqual({ anthropic: { type: "api_key", key: "sk-plain" } })
        if (process.platform !== "win32") {
          expect(statSync(item.authPath).mode & 0o777).toBe(0o600)
        }
        const read = readAuthStore(item.authPath)
        expect(read.entries.anthropic).toEqual({ type: "api_key", key: "sk-plain" })
      })
    })
  })

  describe("#given mode is passphrase and a passphrase is set", () => {
    describe("#when writeAuthStore is called and readAuthStore is called with the same passphrase", () => {
      test("#then it round-trips entry-by-entry and the file on disk holds no plaintext provider or key", () => {
        const item = fixture()

        writeAuthStore(item.authPath, { entries: {}, bytes: undefined }, [
          { provider: "anthropic", key: "sk-pass-1" },
          { provider: "openai", key: "sk-pass-2" },
        ], {
          mode: "passphrase",
          passphrase: "correct-horse-battery-staple",
        })

        const text = readFileSync(item.authPath, "utf8")
        expect(text).not.toContain("sk-pass-1")
        expect(text).not.toContain("sk-pass-2")
        expect(text).not.toContain("anthropic")
        if (process.platform !== "win32") {
          expect(statSync(item.authPath).mode & 0o777).toBe(0o600)
        }

        const read = readAuthStore(item.authPath, {
          mode: "passphrase",
          passphrase: "correct-horse-battery-staple",
        })
        expect(read.entries).toEqual({
          anthropic: { type: "api_key", key: "sk-pass-1" },
          openai: { type: "api_key", key: "sk-pass-2" },
        })
      })
    })
  })

  describe("#given mode is passphrase and a wrong passphrase is supplied", () => {
    describe("#when readAuthStore is called", () => {
      test("#then it fails closed: entries is undefined and a decryption error is reported, never a partial entry", () => {
        const item = fixture()

        writeAuthStore(item.authPath, { entries: {}, bytes: undefined }, [
          { provider: "anthropic", key: "sk-good" },
        ], {
          mode: "passphrase",
          passphrase: "right-key",
        })

        const read = readAuthStore(item.authPath, {
          mode: "passphrase",
          passphrase: "wrong-key",
        })

        expect(read.entries).toBeUndefined()
        expect(read.error).toMatch(/decryption|auth-at-rest/i)
      })
    })
  })

  describe("#given mode is ssh-key and a fixture ssh key is available", () => {
    describe("#when writeAuthStore is called and readAuthStore is called with the same key", () => {
      test("#then it round-trips using the key material and emits no plaintext", () => {
        const item = fixture()
        const sshKeyPath = writeSshFixture(item.sshDir)
        const options = { mode: "ssh-key" as AuthAtRestMode, sshKeyPath }

        writeAuthStore(item.authPath, { entries: {}, bytes: undefined }, [
          { provider: "anthropic", key: "sk-ssh" },
        ], options)

        const text = readFileSync(item.authPath, "utf8")
        expect(text).not.toContain("sk-ssh")
        if (process.platform !== "win32") {
          expect(statSync(item.authPath).mode & 0o777).toBe(0o600)
        }

        const read = readAuthStore(item.authPath, options)
        expect(read.entries.anthropic).toEqual({ type: "api_key", key: "sk-ssh" })
      })
    })
  })

  describe("#given a plaintext auth.json that pre-dates encryption", () => {
    describe("#when the configured mode is ssh-key and the same plaintext is read back", () => {
      test("#then readAuthStore returns the plaintext entries so the next write can rewrite them encrypted", () => {
        const item = fixture()
        writeFileSync(item.authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-legacy" } }))

        const roundTrip = readAuthStore(item.authPath, { mode: "ssh-key", sshKeyPath: "/nonexistent" })
        expect(roundTrip.entries).toEqual({ anthropic: { type: "api_key", key: "sk-legacy" } })

        const sshKeyPath = writeSshFixture(item.sshDir)
        writeAuthStore(item.authPath, roundTrip, [
          { provider: "anthropic", key: "sk-legacy" },
          { provider: "openai", key: "sk-added" },
        ], { mode: "ssh-key", sshKeyPath })

        const encryptedBack = readAuthStore(item.authPath, { mode: "ssh-key", sshKeyPath })
        expect(encryptedBack.entries).toEqual({
          anthropic: { type: "api_key", key: "sk-legacy" },
          openai: { type: "api_key", key: "sk-added" },
        })
        const onDisk = readFileSync(item.authPath, "utf8")
        expect(onDisk).not.toContain("sk-legacy")
        expect(onDisk).not.toContain("sk-added")
      })
    })
  })

  describe("#given an empty additions list and an empty current store in passphrase mode", () => {
    describe("#when writeAuthStore is called", () => {
      test("#then the auth.json is still written as a placeholder so a later read sees a valid store", () => {
        const item = fixture()

        writeAuthStore(item.authPath, { entries: {}, bytes: undefined }, [], {
          mode: "passphrase",
          passphrase: "k",
        })

        const onDisk = readFileSync(item.authPath, "utf8")
        expect(onDisk.length).toBeGreaterThan(0)
        const read = readAuthStore(item.authPath, {
          mode: "passphrase",
          passphrase: "k",
        })
        expect(read.entries).toEqual({})
      })
    })
  })

  describe("#given the security.auth_at_rest mode resolution", () => {
    describe("#when no mode is configured", () => {
      test("#then the default is plain and the prompt is null because the legacy default must not change", () => {
        const resolved = resolveAuthAtRestMode({ home: "/nonexistent", interactive: false, existingEntries: 0 })
        expect(resolved.mode).toBe("plain")
        expect(resolved.shouldPrompt).toBe(false)
      })
    })

    describe("#when an ed25519 key is on disk and existing entries warrant a prompt", () => {
      test("#then the prompted mode is ssh-key (recommended) and the default mode is still plain", () => {
        const item = fixture()
        writeSshFixture(item.sshDir)
        const resolved = resolveAuthAtRestMode({
          home: item.home,
          interactive: true,
          existingEntries: 1,
        })
        expect(resolved.shouldPrompt).toBe(true)
        expect(resolved.recommended).toBe("ssh-key")
        expect(resolved.mode).toBe("plain")
      })
    })

    describe("#when an explicit mode is configured", () => {
      test("#then resolveAuthAtRestMode honors it and never prompts", () => {
        const resolved = resolveAuthAtRestMode({
          home: "/x",
          interactive: true,
          existingEntries: 1,
          configured: "passphrase",
        })
        expect(resolved.mode).toBe("passphrase")
        expect(resolved.shouldPrompt).toBe(false)
      })
    })
  })

  describe("#given an explicit passphrase key derivation", () => {
    test("#then encryptAuthStore and decryptAuthStore round-trip via the raw encrypt/decrypt surface", () => {
      const entries = { anthropic: { type: "api_key", key: "sk-ant-secret-1234567890" }, openai: { type: "api_key", key: "sk-oai-secret-abcdefghij" } }

      const envelope = encryptAuthStore(entries, { passphrase: "p" })
      expect(envelope.mode).toBe("passphrase")
      // The ciphertext is AES-GCM output, base64-encoded. Probability that long random base64
      // contains the exact secret substring is ~(length/64*256) — for these secrets, ~0.
      const secrets = Object.values(entries).map((entry: any) => entry.key)
      for (const secret of secrets) {
        expect(envelope.ciphertext).not.toContain(secret)
      }
      expect(JSON.stringify(envelope)).not.toContain("anthropic")
      expect(JSON.stringify(envelope)).not.toContain("openai")
      expect(decryptAuthStore(envelope, { passphrase: "p" })).toEqual(entries)
    })

    test("#then a tampered ciphertext fails the auth-tag check and is reported as a decryption error", () => {
      const entries = { anthropic: { type: "api_key", key: "sk-correct" } }

      const envelope = encryptAuthStore(entries, { passphrase: "p" })
      const envelopeBytes = Buffer.from(envelope.ciphertext, "base64")
      envelopeBytes[0] = envelopeBytes[0] ^ 0xff
      const tampered = { ...envelope, ciphertext: envelopeBytes.toString("base64") }

      expect(() => decryptAuthStore(tampered, { passphrase: "p" })).toThrow(/decryption|auth-at-rest/)
    })
  })
})
