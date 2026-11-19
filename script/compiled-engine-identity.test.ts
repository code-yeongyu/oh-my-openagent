// senpi#7040 / omo#14314: a compiled omo binary reads its stamped sibling package.json ({ name: "omo", version: <omo-ai
// version> }) as the engine's VERSION, so through 5.1.78 its hosts advertised engineOrdinal [5,1,78,0,0]. The identity a
// compiled host advertises must be the embedded senpi's CalVer, the only vocabulary engine ordinals are ordered in.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createStampedPackageJson } from "./build-omo-binary"
import { engineVersionDefineArgs, readSenpiPackageJson } from "./engine-build-defines"
import { senpiPackageDir } from "./engine-sidecar-sources"

const entry = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "compiled-engine-identity", "entry.ts")
const pinned = readSenpiPackageJson(senpiPackageDir) as { readonly version: string }

describe("compiled engine identity", () => {
  test("#given the pinned senpi package #when its version define is resolved #then it carries that senpi CalVer", () => {
    expect(engineVersionDefineArgs(pinned)).toEqual(["--define", `SENPI_ENGINE_VERSION=${JSON.stringify(pinned.version)}`])
  })

  test("#given an engine package without a senpi CalVer version #when the define is resolved #then the build refuses", () => {
    expect(() => engineVersionDefineArgs({ name: "omo", version: "5.1.78" })).toThrow("no senpi CalVer version")
    expect(() => engineVersionDefineArgs(undefined)).toThrow("no senpi CalVer version")
  })

  test("#given an omo-stamped package.json beside the binary #when the compiled engine reports its identity #then the ordinal is the embedded senpi CalVer", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-engine-identity-"))
    try {
      const binary = join(root, process.platform === "win32" ? "omo.exe" : "omo")
      writeFileSync(join(root, "package.json"), createStampedPackageJson("5.1.78"))
      const built = Bun.spawnSync(
        [process.execPath, "build", "--compile", "--external", "canvas", ...engineVersionDefineArgs(pinned), entry, "--outfile", binary],
        { stdout: "pipe", stderr: "pipe" },
      )
      expect(built.exitCode, built.stderr.toString()).toBe(0)
      const ran = Bun.spawnSync([binary], { cwd: root, stdout: "pipe", stderr: "pipe" })
      expect(ran.exitCode, ran.stderr.toString()).toBe(0)
      const identity = JSON.parse(ran.stdout.toString().trim().split("\n").at(-1) ?? "") as {
        readonly text: string
        readonly ordinal: readonly number[]
      }
      const [year, month, day, post] = pinned.version.split(/[.-]/).map(Number)
      expect(identity.text.startsWith(pinned.version)).toBe(true)
      expect(identity.ordinal.slice(0, 4)).toEqual([year, month, day, post ?? 0])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 300_000)
})
