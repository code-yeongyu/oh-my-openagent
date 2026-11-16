import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { launchFromStablePath } from "../src/stable-launch.ts"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-computer-engine-stable-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex")

function source(bytes: string): { readonly path: string; readonly host: string; readonly sha256: string } {
  const path = join(root, `source-${sha256(bytes).slice(0, 8)}`)
  writeFileSync(path, bytes, { mode: 0o755 })
  return { path, host: "linux-x64", sha256: sha256(bytes) }
}

describe("stable-path launch under the lock", () => {
  it("a stale stable copy is replaced by the verified bytes and the spawn sees exactly them", () => {
    // Given a stable directory holding an older engine.
    const dir = join(root, "stable")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "omo-computer-engine"), "old engine", { mode: 0o755 })

    // When a new verified source is launched from the stable path.
    const launched = launchFromStablePath(
      { ...source("new engine"), directory: dir, fileName: "omo-computer-engine" },
      (path) => readFileSync(path, "utf8"),
      () => true,
    )

    // Then the stable file holds the new bytes, is executable, and the spawn read them.
    expect(launched.value).toBe("new engine")
    expect(statSync(launched.path).mode & 0o111).not.toBe(0)
  })

  it("a staged copy that fails the signature check is refused and the stable copy is untouched", () => {
    // Given a stable directory holding a good engine.
    const dir = join(root, "stable")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "omo-computer-engine"), "good engine", { mode: 0o755 })
    const spawned: string[] = []

    // When a source whose signature check fails is launched.
    const attempt = () =>
      launchFromStablePath(
        { ...source("unsigned engine"), directory: dir, fileName: "omo-computer-engine" },
        (path) => spawned.push(path),
        () => false,
      )

    // Then it refuses for the designated requirement, nothing spawned, the old copy stays.
    expect(attempt).toThrow(expect.objectContaining({ reason: "designated_requirement_mismatch" }))
    expect(spawned).toEqual([])
    expect(readFileSync(join(dir, "omo-computer-engine"), "utf8")).toBe("good engine")
  })

  it("a stable path that is a symlink to the verified bytes is replaced by a file we wrote before the spawn", () => {
    // Given the stable path is a symlink (placed by another process of this user) to identical bytes elsewhere.
    const dir = join(root, "stable")
    mkdirSync(dir, { recursive: true })
    const elsewhere = join(root, "elsewhere-engine")
    writeFileSync(elsewhere, "new engine", { mode: 0o755 })
    symlinkSync(elsewhere, join(dir, "omo-computer-engine"))

    // When the verified source with those bytes is launched.
    const launched = launchFromStablePath(
      { ...source("new engine"), directory: dir, fileName: "omo-computer-engine" },
      (path) => lstatSync(path).isFile(),
      () => true,
    )

    // Then the spawn saw a regular file at the stable path, and the link's target was left alone.
    expect(launched.value).toBe(true)
    expect(readFileSync(elsewhere, "utf8")).toBe("new engine")
  })
})
