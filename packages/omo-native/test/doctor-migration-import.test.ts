import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// The compiled omo binary imports the launcher modules from $bunfs, where the package root has no
// package.json until first-run provisioning. Copying bin/lib into a directory with no manifest above
// it reproduces that condition for the module graph (#8891).
const libDir = join(import.meta.dir, "..", "bin", "lib")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("doctor-migration import", () => {
  test("#given no package manifest above the launcher modules #when doctor-migration is imported #then the import succeeds", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-manifestless-"))
    roots.push(root)
    cpSync(libDir, join(root, "bin", "lib"), { recursive: true })
    expect(existsSync(join(root, "package.json"))).toBe(false)

    // when
    const module = await import(pathToFileURL(join(root, "bin", "lib", "doctor-migration.js")).href)

    // then
    expect(typeof module.formatMigrationLines).toBe("function")
  })
})
