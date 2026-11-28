import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Package contract: the vendored copy ships byte for byte as recorded in its SOURCE.json, so a partial re-vendor cannot land.
const vendorDir = join(import.meta.dir, "skills", "github", "scripts", "vendor", "surface")

const sha256 = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")

describe("github skill vendored surface library", () => {
  test("#given SOURCE.json #when the files on disk are hashed #then every file matches its manifest entry and no file is missing or extra", () => {
    // given
    const manifest: { files: Record<string, string> } = JSON.parse(readFileSync(join(vendorDir, "SOURCE.json"), "utf8"))
    const onDisk = readdirSync(vendorDir)
      .filter((name) => name !== "SOURCE.json")
      .toSorted()

    // when
    const actual = Object.fromEntries(onDisk.map((name) => [name, sha256(join(vendorDir, name))]))

    // then
    expect(actual).toEqual(manifest.files)
  })
})
