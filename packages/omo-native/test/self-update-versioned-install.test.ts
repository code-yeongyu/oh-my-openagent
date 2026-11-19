import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { runSelfUpdate } from "../bin/lib/self-update.js"

// #12022: the omo on PATH can come from a side-by-side layout `<versions>/<ver>/node_modules/omo-ai` with
// `<versions>/current -> <ver>` and an entry linked through `current`. `omo update` must update THAT
// install with bun and switch `current` atomically, never `npm i -g` into an install PATH does not run.

const posix = process.platform !== "win32"
const PRINT_VERSION = [
  "#!/bin/sh",
  'here=$(dirname "$(readlink -f "$0")")',
  'printf "omo %s (engine: senpi 0.0.0)\\n" "$(sed -n \'s/.*"version": *"\\([^"]*\\)".*/\\1/p\' "$here/../package.json")"',
  "",
].join("\n")

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function writePackage(versionDir: string, version: string) {
  const pkg = join(versionDir, "node_modules", "omo-ai")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "omo-ai", version })}\n`)
  writeFileSync(join(pkg, "bin", "omo.js"), PRINT_VERSION, { mode: 0o755 })
  mkdirSync(join(versionDir, "node_modules", ".bin"), { recursive: true })
  symlinkSync("../omo-ai/bin/omo.js", join(versionDir, "node_modules", ".bin", "omo"))
}

const MANIFEST = { private: true, dependencies: { "omo-ai": "5.1.77" }, trustedDependencies: ["omo-ai"] }

function fixture(shape: "wrapper" | "bin-link") {
  const home = mkdtempSync(join(tmpdir(), "omo-12022-"))
  homes.push(home)
  const versions = join(home, ".omo", "omo-versions")
  const bunBin = join(home, ".bun", "bin")
  const old = join(versions, "5.1.77")
  mkdirSync(old, { recursive: true })
  mkdirSync(bunBin, { recursive: true })
  writeFileSync(join(bunBin, "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  writeFileSync(join(old, "package.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`)
  writePackage(old, "5.1.77")
  if (shape === "wrapper") {
    const entry = join(old, "node_modules", "omo-ai", "bin", "omo.js")
    writeFileSync(join(old, "omo"), `#!/bin/sh\n# versioned launcher\nexec '${entry}' "$@"\n`, { mode: 0o755 })
  }
  symlinkSync("5.1.77", join(versions, "current"))
  const rel = shape === "wrapper" ? "omo" : join("node_modules", ".bin", "omo")
  symlinkSync(join(versions, "current", rel), join(bunBin, "omo"))
  const spawned: Array<{ command: string; args: string[]; cwd: string | undefined }> = []
  const lines: string[] = []
  const errors: string[] = []
  const env = { HOME: home, PATH: `${bunBin}:/usr/bin:/bin`, OMO_RUNTIME: "node" }
  return {
    home,
    versions,
    bunBin,
    rel,
    spawned,
    lines,
    errors,
    env,
    options: (installs: { version?: string; status?: number } = {}) => ({
      root: join(versions, "current", "node_modules", "omo-ai"),
      fetchDistTags: () => ({ latest: "5.1.78" }),
      readInstalled: () => ({ omo: "5.1.77", engine: "2026.11.1" }),
      env,
      platform: "linux" as const,
      log: (line: string) => lines.push(line),
      error: (line: string) => errors.push(line),
      // Stands in for `bun install`: it materializes whatever omo-ai version the staged manifest names.
      run: async (command: string, args: string[], runOptions: { cwd?: string } = {}) => {
        spawned.push({ command, args, cwd: runOptions.cwd })
        const status = installs.status ?? 0
        if (status === 0 && runOptions.cwd !== undefined) {
          const manifest = JSON.parse(readFileSync(join(runOptions.cwd, "package.json"), "utf8"))
          writePackage(runOptions.cwd, installs.version ?? manifest.dependencies["omo-ai"])
        }
        return { status, signal: null }
      },
    }),
  }
}

const strays = (versions: string) => readdirSync(versions).filter((name) => name.startsWith(".stage-"))

describe.skipIf(!posix)("omo update on a versioned install layout (#12022)", () => {
  for (const shape of ["wrapper", "bin-link"] as const) {
    test(`#given the ${shape} layout on PATH #when a newer omo-ai is published #then bun installs it beside the old one and current switches to it`, async () => {
      const f = fixture(shape)
      const code = await runSelfUpdate(["update"], f.options())

      expect(f.errors).toEqual([])
      expect(code).toBe(0)
      expect(f.spawned.map((call) => [call.command, ...call.args])).toEqual([[join(f.bunBin, "bun"), "install"]])
      expect(dirname(f.spawned[0]?.cwd ?? "")).toBe(f.versions)
      const next = join(f.versions, "5.1.78")
      expect(readlinkSync(join(f.versions, "current"))).toBe("5.1.78")
      expect(JSON.parse(readFileSync(join(next, "package.json"), "utf8"))).toEqual({
        ...MANIFEST,
        dependencies: { "omo-ai": "5.1.78" },
      })
      expect(existsSync(join(next, ".complete"))).toBe(true)
      expect(existsSync(join(f.versions, "5.1.77", "node_modules", "omo-ai", "package.json"))).toBe(true)
      expect(strays(f.versions)).toEqual([])
      if (shape === "wrapper") {
        const launcher = readFileSync(join(next, "omo"), "utf8")
        expect(launcher).toContain(`${next}/node_modules/omo-ai/bin/omo.js`)
        expect(launcher).not.toContain(`${join(f.versions, "5.1.77")}/`)
      }
      const proc = Bun.spawnSync([join(f.bunBin, "omo"), "--version"], { env: f.env })
      expect(proc.stdout.toString().trim()).toBe("omo 5.1.78 (engine: senpi 0.0.0)")
    })
  }

  test("#given bun install fails #then current keeps the old version, no partial dir is left and the error names the layout", async () => {
    const f = fixture("wrapper")
    const code = await runSelfUpdate(["update"], f.options({ status: 7 }))

    expect(code).toBe(7)
    expect(readlinkSync(join(f.versions, "current"))).toBe("5.1.77")
    expect(existsSync(join(f.versions, "5.1.78"))).toBe(false)
    expect(strays(f.versions)).toEqual([])
    expect(f.errors.join("\n")).toContain(f.versions)
    expect(f.errors.join("\n")).not.toContain("npm i -g")
  })

  test("#given the installed dir reports another version #then current is not switched and the dir is set aside", async () => {
    const f = fixture("wrapper")
    const code = await runSelfUpdate(["update"], f.options({ version: "5.1.76" }))

    expect(code).toBe(1)
    expect(readlinkSync(join(f.versions, "current"))).toBe("5.1.77")
    expect(existsSync(join(f.versions, "5.1.78"))).toBe(false)
    expect(readdirSync(f.versions).filter((name) => name.startsWith(".failed-5.1.78-"))).toHaveLength(1)
  })

  test("#given another omo earlier on PATH #then it reports the updated layout and the stale PATH omo by path, exiting non-zero", async () => {
    const f = fixture("wrapper")
    const shadowDir = join(f.home, "shadow", "bin")
    mkdirSync(shadowDir, { recursive: true })
    const shadow = join(shadowDir, "omo")
    writeFileSync(shadow, '#!/bin/sh\necho "omo 5.1.77 (engine: senpi 0.0.0)"\n', { mode: 0o755 })
    f.env.PATH = `${shadowDir}:${f.env.PATH}`

    const code = await runSelfUpdate(["update"], f.options())

    expect(code).toBe(1)
    expect(readlinkSync(join(f.versions, "current"))).toBe("5.1.78")
    const report = f.errors.join("\n")
    expect(report).toContain(`${join(f.versions, "current")} -> 5.1.78`)
    expect(report).toContain(shadow)
    expect(report).toContain("omo 5.1.77")
    expect(report).toContain(join(f.versions, "current", "omo"))
    expect(report).not.toContain("update failed")
  })

  test("#given a target dir without .complete that runs the target #then it is adopted, not reinstalled", async () => {
    const f = fixture("wrapper")
    const next = join(f.versions, "5.1.78")
    writePackage(next, "5.1.78")
    writeFileSync(join(next, "package.json"), `${JSON.stringify(MANIFEST)}\n`)
    const entry = join(next, "node_modules", "omo-ai", "bin", "omo.js")
    writeFileSync(join(next, "omo"), `#!/bin/sh\nexec '${entry}' "$@"\n`, { mode: 0o755 })

    const code = await runSelfUpdate(["update"], f.options())

    expect(f.errors).toEqual([])
    expect(code).toBe(0)
    expect(f.spawned).toEqual([])
    expect(existsSync(join(next, ".complete"))).toBe(true)
    expect(readlinkSync(join(f.versions, "current"))).toBe("5.1.78")
    expect(readdirSync(f.versions).filter((name) => name.startsWith(".failed-"))).toEqual([])
  })

  test("#given another live installer's stage for the target #then the update stops without touching current or the stage", async () => {
    const f = fixture("wrapper")
    const foreign = join(f.versions, `.stage-5.1.78-${process.ppid}`)
    mkdirSync(foreign)

    const code = await runSelfUpdate(["update"], f.options())

    expect(code).not.toBe(0)
    expect(f.spawned).toEqual([])
    expect(f.errors.join("\n")).toContain(`another installer is updating ${join(f.versions, "5.1.78")}`)
    expect(readlinkSync(join(f.versions, "current"))).toBe("5.1.77")
    expect(existsSync(foreign)).toBe(true)
  })

  test("#given leftovers in the versions dir #then only the two newest .failed dirs and live stages survive", async () => {
    const f = fixture("wrapper")
    const leftovers = [".failed-5.1.70-100", ".failed-5.1.71-200", ".failed-5.1.72-300", ".stage-5.1.60-99999999"]
    const liveStage = `.stage-5.1.99-${process.ppid}`
    for (const name of [...leftovers, liveStage]) mkdirSync(join(f.versions, name))

    expect(await runSelfUpdate(["update"], f.options())).toBe(0)

    const dotted = readdirSync(f.versions)
      .filter((name) => name.startsWith("."))
      .sort()
    expect(dotted).toEqual([".failed-5.1.71-200", ".failed-5.1.72-300", liveStage])
  })

  test("#given a wrapper that names its dir without a trailing slash #then the new wrapper is regenerated for the new dir", async () => {
    const f = fixture("wrapper")
    const old = join(f.versions, "5.1.77")
    writeFileSync(join(old, "omo"), `#!/bin/sh\ncd '${old}' && exec ./node_modules/omo-ai/bin/omo.js "$@"\n`, {
      mode: 0o755,
    })

    const code = await runSelfUpdate(["update"], f.options())

    expect(f.errors).toEqual([])
    expect(code).toBe(0)
    expect(readFileSync(join(f.versions, "5.1.78", "omo"), "utf8")).not.toContain(old)
    const proc = Bun.spawnSync([join(f.bunBin, "omo"), "--version"], { env: f.env })
    expect(proc.stdout.toString().trim()).toBe("omo 5.1.78 (engine: senpi 0.0.0)")
  })
})
