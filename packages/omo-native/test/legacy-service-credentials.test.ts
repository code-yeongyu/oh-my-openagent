import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeLegacyServiceCredentials } from "../bin/lib/legacy-service-credentials.js"

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function homeWith(content?: string): { home: string; path: string } {
  const home = mkdtempSync(join(tmpdir(), "omo-legacy-creds-"))
  homes.push(home)
  mkdirSync(join(home, ".omo"), { recursive: true })
  const path = join(home, ".omo", "credentials.json")
  if (content !== undefined) writeFileSync(path, content, { mode: 0o644 })
  return { home, path }
}

const LEGACY = JSON.stringify({
  accessToken: "synthetic-access",
  accessTokenExpiresAt: "2026-10-10T00:00:00.000Z",
  device: { id: "synthetic-device", name: "synthetic" },
  offlineGrant: "synthetic-grant",
  refreshToken: "synthetic-refresh",
  sealingPrivateKey: "synthetic-sealing-private",
  signingPrivateKey: "synthetic-signing-private",
})

describe("removeLegacyServiceCredentials", () => {
  test("#given the legacy credentials shape #when it runs #then the file is removed", () => {
    const { home, path } = homeWith(LEGACY)
    expect(removeLegacyServiceCredentials(home)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  test("#given no file #when it runs #then it is a no-op", () => {
    const { home } = homeWith()
    expect(removeLegacyServiceCredentials(home)).toBe(false)
  })

  test("#given a file without both private keys #when it runs #then the file is kept", () => {
    const { home, path } = homeWith(JSON.stringify({ signingPrivateKey: "only-one", refreshToken: "x" }))
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test("#given invalid JSON #when it runs #then the file is kept", () => {
    const { home, path } = homeWith("{not json")
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test("#given a symlink to a legacy-shaped file #when it runs #then neither link nor target is removed", () => {
    const { home, path } = homeWith()
    const target = join(home, "elsewhere.json")
    writeFileSync(target, LEGACY)
    symlinkSync(target, path)
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(existsSync(target)).toBe(true)
  })

  test("#given a JSON array #when it runs #then the file is kept", () => {
    const { home, path } = homeWith(JSON.stringify(["signingPrivateKey", "sealingPrivateKey"]))
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test("#given a directory at the credentials path #when it runs #then it is kept", () => {
    const { home, path } = homeWith()
    mkdirSync(path)
    writeFileSync(join(path, "inner.json"), LEGACY)
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(join(path, "inner.json"))).toBe(true)
  })

  test("#given a legacy-shaped file over 64 KiB #when it runs #then it is kept", () => {
    const padded = JSON.stringify({ ...JSON.parse(LEGACY), padding: "x".repeat(64 * 1024) })
    const { home, path } = homeWith(padded)
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test("#given `.omo` is a file rather than a directory #when it runs #then it is a no-op", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-legacy-creds-"))
    homes.push(home)
    writeFileSync(join(home, ".omo"), "not a directory")
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(join(home, ".omo"))).toBe(true)
  })

  test.skipIf(process.platform === "win32")("#given a FIFO at the credentials path #when it runs #then it is kept", () => {
    const { home, path } = homeWith()
    const made = spawnSync("mkfifo", [path])
    expect(made.status).toBe(0)
    expect(removeLegacyServiceCredentials(home)).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("#given a read-only `.omo` holding a legacy file #when unlink is refused #then it reports false and keeps the file", () => {
    const { home, path } = homeWith(LEGACY)
    const dir = join(home, ".omo")
    chmodSync(dir, 0o500)
    try {
      expect(removeLegacyServiceCredentials(home)).toBe(false)
      expect(existsSync(path)).toBe(true)
    } finally {
      chmodSync(dir, 0o700)
    }
  })
})
