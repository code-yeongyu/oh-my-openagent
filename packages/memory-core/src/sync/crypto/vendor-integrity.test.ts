import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { relative, resolve, sep } from "node:path"

/** Vendored-copy provenance guard (todo 13): fails on any drift from the recorded manifest. */

const VENDOR = resolve(import.meta.dir, "vendor")

type VendorManifest = {
  readonly source: { readonly repo: string; readonly commit: string }
  readonly files: Readonly<Record<string, string>>
}

const readManifest = (): VendorManifest => {
  const parsed: VendorManifest = JSON.parse(readFileSync(resolve(VENDOR, "manifest.json"), "utf8"))
  return parsed
}

const walkFiles = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name)
    return statSync(path).isDirectory() ? walkFiles(path) : [path]
  })

const readBytes = (path: string): Uint8Array<ArrayBuffer> => {
  const buffer = readFileSync(path)
  const bytes = new Uint8Array(buffer.length)
  bytes.set(buffer)
  return bytes
}

const sha256B64 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Buffer.from(digest).toString("base64url")
}

describe("the vendored sync-format library and sync-v1 fixtures", () => {
  test("every vendored file's sha256 matches the recorded manifest", async () => {
    const manifest = readManifest()
    const entries = Object.entries(manifest.files)
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, recorded] of entries) {
      const bytes = readBytes(resolve(VENDOR, path))
      expect(await sha256B64(bytes), path).toBe(recorded)
    }
  })

  test("the manifest covers exactly the vendored tree (no strays, no drops)", () => {
    const manifest = readManifest()
    const onDisk = walkFiles(VENDOR)
      .map((path) => relative(VENDOR, path).split(sep).join("/"))
      .filter((path) => path !== "manifest.json" && path !== "README.md")
      .sort()
    expect(onDisk).toEqual(Object.keys(manifest.files).sort())
  })
})
