import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compileDefinesForOmoBinary, createStampedPackageJson } from "./build-omo-binary"
import { readSenpiPackageJson } from "./engine-build-defines"
import { senpiPackageDir } from "./engine-sidecar-sources"

const entry = join(import.meta.dir, "fixtures", "compiled-engine-identity", "entry.ts")
const pinned = readSenpiPackageJson(senpiPackageDir) as { readonly version: string }

function probe(root: string, omoVersion: string, senpiVersion: string) {
  const cwd = join(root, omoVersion)
  mkdirSync(cwd)
  const binary = join(cwd, process.platform === "win32" ? "omo.exe" : "omo")
  writeFileSync(join(cwd, "package.json"), createStampedPackageJson(omoVersion))
  const args = compileDefinesForOmoBinary({ senpiPackage: { ...pinned, version: senpiVersion } })
  const built = Bun.spawnSync(
    [process.execPath, "build", "--compile", "--external", "canvas", ...args, entry, "--outfile", binary],
    { stdout: "pipe", stderr: "pipe" },
  )
  if (built.exitCode !== 0) throw new Error(`bun build --compile failed:\n${built.stderr.toString()}`)
  const ran = Bun.spawnSync([binary], { cwd, stdout: "pipe", stderr: "pipe" })
  if (ran.exitCode !== 0) throw new Error(`the compiled probe failed:\n${ran.stderr.toString()}`)
  return JSON.parse(ran.stdout.toString().trim().split("\n").at(-1) ?? "") as {
    readonly text: string
    readonly ordinal: readonly number[]
  }
}

describe("compiled engine identity", () => {
  test("#given the pinned senpi package #when the compile defines are resolved #then they carry its CalVer", () => {
    expect(compileDefinesForOmoBinary({ senpiPackage: pinned })).toContain(
      `SENPI_ENGINE_VERSION=${JSON.stringify(pinned.version)}`,
    )
  })

  test("#given an engine package without a senpi CalVer #when compile defines are resolved #then the build refuses", () => {
    expect(() => compileDefinesForOmoBinary({ senpiPackage: { version: "5.1.78" } })).toThrow("no senpi CalVer version")
    expect(() => compileDefinesForOmoBinary({})).toThrow("no senpi CalVer version")
  })

  test("#given two compiled omo builds #when they report their engine identity #then their ordinals follow senpi CalVer order", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-engine-identity-"))
    try {
      // Vary the embedded version at compile time while keeping the installed engine source fixed.
      const [year, month, day, post = 0] = pinned.version.split(/[.-]/).map(Number)
      const nextVersion = `${year}.${month}.${day}-${post + 1}`
      const older = probe(root, "5.1.79", pinned.version)
      const newer = probe(root, "5.1.81", nextVersion)
      expect(older.text.split(" ")[0]).toBe(pinned.version)
      expect(newer.text.split(" ")[0]).toBe(nextVersion)
      expect(older.ordinal).toEqual([year, month, day, post, 0])
      expect(newer.ordinal).toEqual([year, month, day, post + 1, 0])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 300_000)
})
