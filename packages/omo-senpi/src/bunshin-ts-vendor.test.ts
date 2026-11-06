import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { copyVendored, digestTree } from "../scripts/sync-bunshin-ts.ts"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const vendorRoot = join(packageRoot, "vendor")
const VENDORED_NAMES = ["@sisyphuslabs/bunshin-ts", "@sisyphuslabs/bunshin-ts-relay"]

type Pin = { packages: Record<string, { name: string; files: Record<string, string> }> }

const pin = (): Pin => JSON.parse(readFileSync(join(vendorRoot, "PIN.json"), "utf8")) as Pin

const importsVendoredName = (source: string): string[] =>
  [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g)]
    .map(match => match[1] ?? "")
    .filter(specifier => VENDORED_NAMES.some(name => specifier === name || specifier.startsWith(`${name}/`)))

describe("vendored bunshin-ts packages", () => {
  it("#given vendor/PIN.json #when every vendored file is hashed #then the bytes and the file set equal the PIN", () => {
    const packages = pin().packages
    expect(Object.values(packages).map(entry => entry.name).sort()).toEqual(VENDORED_NAMES)
    for (const [key, entry] of Object.entries(packages)) {
      expect(Object.keys(entry.files)).toContain("LICENSE")
      expect(digestTree(join(vendorRoot, key))).toEqual(entry.files)
    }
  })

  it("#given a build output with a nested package.json #when it is vendored #then only the top-level manifest is left out of both the copy and the digests", () => {
    const work = mkdtempSync(join(tmpdir(), "vendor-copy-"))
    try {
      const out = join(work, "out")
      mkdirSync(join(out, "types"), { recursive: true })
      writeFileSync(join(out, "package.json"), '{"name":"pkg"}')
      writeFileSync(join(out, "index.js"), "export {}")
      writeFileSync(join(out, "types", "package.json"), '{"type":"module"}')
      const dest = join(work, "dest")
      copyVendored(out, dest)
      expect(existsSync(join(dest, "package.json"))).toBe(false)
      expect(Object.keys(digestTree(dest))).toEqual(["index.js", "types/package.json"])
      expect(digestTree(dest)).toEqual(digestTree(out))
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  // Package contract: neither package is on npm, so a by-name import or dependency would break every install of this adapter.
  it("#given the omo-senpi sources and manifest #when imports are scanned #then nothing imports a vendored package by name", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const declared = Object.keys((manifest[field] as Record<string, string> | undefined) ?? {})
      expect(declared.filter(name => VENDORED_NAMES.includes(name))).toEqual([])
    }
    const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "."], { cwd: packageRoot, encoding: "utf8" })
      .split("\n")
      .filter(path => /\.(?:[cm]?[jt]s|tsx)$/.test(path) && !path.startsWith("vendor/"))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.flatMap(path => importsVendoredName(readFileSync(join(packageRoot, path), "utf8")).map(specifier => `${path}: ${specifier}`))
    expect(offenders).toEqual([])
  })
})
