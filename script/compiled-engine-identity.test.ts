// senpi#7040 / omo#14314: a compiled omo binary reads its stamped sibling package.json, whose version is the omo-ai
// release number, as the engine's VERSION, so through 5.1.78 its hosts advertised engineOrdinal [5,1,78,0,0]. The
// identity a compiled host advertises must be the embedded senpi's CalVer, the only vocabulary engine ordinals are
// ordered in.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compileDefinesForOmoBinary, createStampedPackageJson } from "./build-omo-binary"
import { readSenpiPackageJson } from "./engine-build-defines"
import { senpiPackageDir } from "./engine-sidecar-sources"

const entry = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "compiled-engine-identity", "entry.ts")
const pinned = readSenpiPackageJson(senpiPackageDir) as { readonly version: string }
const root = mkdtempSync(join(tmpdir(), "omo-engine-identity-"))
let reported: { readonly text: string; readonly ordinal: readonly number[] } | undefined

beforeAll(() => {
  const binary = join(root, process.platform === "win32" ? "omo.exe" : "omo")
  writeFileSync(join(root, "package.json"), createStampedPackageJson("5.1.78"))
  const args = compileDefinesForOmoBinary({ senpiPackage: pinned })
  const built = Bun.spawnSync(
    [process.execPath, "build", "--compile", "--external", "canvas", ...args, entry, "--outfile", binary],
    { stdout: "pipe", stderr: "pipe" },
  )
  if (built.exitCode !== 0) throw new Error(`bun build --compile failed:\n${built.stderr.toString()}`)
  const ran = Bun.spawnSync([binary], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if (ran.exitCode !== 0) throw new Error(`the compiled probe failed:\n${ran.stderr.toString()}`)
  reported = JSON.parse(ran.stdout.toString().trim().split("\n").at(-1) ?? "")
}, 300_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("compiled engine identity", () => {
  test("#given the pinned senpi package #when the compile defines are resolved #then they carry its CalVer", () => {
    expect(compileDefinesForOmoBinary({ senpiPackage: pinned })).toContain(
      `SENPI_ENGINE_VERSION=${JSON.stringify(pinned.version)}`,
    )
  })

  test("#given an engine package without a senpi CalVer version #when the defines are resolved #then the build refuses", () => {
    expect(() => compileDefinesForOmoBinary({ senpiPackage: { name: "omo", version: "5.1.78" } })).toThrow(
      "no senpi CalVer version",
    )
    expect(() => compileDefinesForOmoBinary({ senpiPackage: undefined })).toThrow("no senpi CalVer version")
  })

  test("#given an omo-stamped package.json beside the binary #when the compiled engine reports its identity #then the ordinal is the embedded senpi CalVer", () => {
    const [year, month, day, post] = pinned.version.split(/[.-]/).map(Number)
    expect(reported?.text.startsWith(pinned.version)).toBe(true)
    expect(reported?.ordinal.slice(0, 4)).toEqual([year, month, day, post ?? 0])
  })
})
