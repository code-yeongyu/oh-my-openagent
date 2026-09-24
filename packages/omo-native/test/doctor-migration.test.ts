import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, relative } from "node:path"
import { migrationReport } from "../bin/lib/doctor-migration.js"
import { runDoctor } from "../bin/lib/doctor.js"
import { updateTarget } from "../bin/lib/package-paths.js"

const RESTORE = "bun add -g omo-ai@beta"
const REPAIR = "bunx oh-my-openagent@beta install --platform=native"
const MIGRATION_MODULE = join(import.meta.dir, "..", "bin", "lib", "doctor-migration.js")
// Runs the report in a child so a read that blocks on a FIFO fails by timeout instead of hanging the suite.
const CHILD_REPORT = `const { migrationReport } = await import(${JSON.stringify(MIGRATION_MODULE)})
const env = { PATH: process.env.PROBE_PATH, BUN_INSTALL: process.env.PROBE_BUN }
console.log(JSON.stringify(migrationReport({ env, homeDir: process.env.PROBE_HOME, platform: "linux" }, "restore")))`
const roots: string[] = []

type Sandbox = { root: string; home: string; npmPrefix: string; npmBin: string; bunRoot: string; bunBin: string }

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-doctor-migration-")))
  roots.push(root)
  const npmPrefix = join(root, "npm-global")
  const bunRoot = join(root, "bun")
  return { root, home: join(root, "home"), npmPrefix, npmBin: join(npmPrefix, "bin"), bunRoot, bunBin: join(bunRoot, "bin") }
}

/** A global install laid out the way npm and bun do it: the package, and `omo` linked into the bin dir. */
function installPackage(modulesDir: string, binDir: string, name: string, version: string, withBin = true): string {
  const packageDir = join(modulesDir, name)
  const entry = join(packageDir, "bin", "omo.js")
  writeFile(join(packageDir, "package.json"), JSON.stringify({ name, version, bin: { omo: "bin/omo.js" } }))
  writeFile(entry, "#!/usr/bin/env node\n")
  if (withBin) {
    mkdirSync(binDir, { recursive: true })
    symlinkSync(relative(binDir, entry), join(binDir, "omo"))
  }
  return packageDir
}

function installNpmLegacy(sandbox: Sandbox, name = "oh-my-openagent", withBin = true): string {
  return installPackage(join(sandbox.npmPrefix, "lib", "node_modules"), sandbox.npmBin, name, "4.19.4", withBin)
}

function installBunNative(sandbox: Sandbox): void {
  installPackage(join(sandbox.bunRoot, "install", "global", "node_modules"), sandbox.bunBin, "omo-ai", "5.0.0-0.beta.89")
}

function report(sandbox: Sandbox, pathDirs: string[], extraEnv: Record<string, string> = {}): string[] {
  return migrationReport({
    env: { PATH: pathDirs.join(delimiter), BUN_INSTALL: sandbox.bunRoot, ...extraEnv },
    homeDir: sandbox.home,
    platform: "linux",
  }, RESTORE)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo doctor migration checks", () => {
  describe("#given the legacy npm package owns an omo ahead of omo-ai's bun bin", () => {
    test("#then the PATH warning names the file, the owner and the repair command", () => {
      const sandbox = createSandbox()
      installNpmLegacy(sandbox)
      installBunNative(sandbox)

      const lines = report(sandbox, [sandbox.npmBin, sandbox.bunBin])

      const pathWarning = lines.find((line) => line.startsWith("WARN another omo precedes omo-ai on PATH:"))
      expect(pathWarning).toContain(join(sandbox.npmBin, "omo"))
      expect(pathWarning).toContain("(oh-my-openagent@4.19.4)")
      expect(pathWarning).toContain(REPAIR)
    })

    test("#then the legacy package warning carries the npm uninstall command and the omo-ai restore note", () => {
      const sandbox = createSandbox()
      const packageDir = installNpmLegacy(sandbox)
      installBunNative(sandbox)

      const lines = report(sandbox, [sandbox.npmBin, sandbox.bunBin])

      const packageWarning = lines.find((line) => line.startsWith("WARN legacy package oh-my-openagent@4.19.4"))
      expect(packageWarning).toContain(packageDir)
      expect(packageWarning).toContain("npm uninstall -g oh-my-openagent")
      expect(packageWarning).toContain(RESTORE)
    })
  })

  describe("#given omo-ai's bin comes first on PATH", () => {
    test("#then no PATH warning is printed while the installed legacy package is still reported", () => {
      const sandbox = createSandbox()
      installNpmLegacy(sandbox)
      installBunNative(sandbox)

      const lines = report(sandbox, [sandbox.bunBin, sandbox.npmBin])

      expect(lines.filter((line) => line.includes("precedes omo-ai"))).toEqual([])
      expect(lines.filter((line) => line.startsWith("WARN legacy package"))).toHaveLength(1)
    })
  })

  describe("#given omo-ai's bun bin is its own launcher shim script", () => {
    test("#then the shim is recognised as omo-ai and nothing is reported", () => {
      const sandbox = createSandbox()
      const entry = join(sandbox.bunRoot, "install", "global", "node_modules", "omo-ai", "bin", "omo.js")
      writeFile(join(dirname(dirname(entry)), "package.json"), JSON.stringify({ name: "omo-ai", version: "5.0.0-0.beta.89" }))
      writeFile(entry, "#!/usr/bin/env node\n")
      writeFile(join(sandbox.bunBin, "omo"), `#!/bin/sh\n# omo-ai bun launcher shim v1\nexec '${entry}' "$@"\n`)
      const foreignDir = join(sandbox.root, "later")
      writeFile(join(foreignDir, "omo"), "#!/bin/sh\necho other\n")

      expect(report(sandbox, [sandbox.bunBin, foreignDir])).toEqual([])
    })
  })

  describe("#given an omo no known package owns is ahead of omo-ai", () => {
    test("#then it is reported with an unknown owner and the PATH reorder fix instead of the installer", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const foreignDir = join(sandbox.root, "custom-bin")
      writeFile(join(foreignDir, "omo"), "#!/bin/sh\necho other\n")

      const lines = report(sandbox, [foreignDir, sandbox.bunBin])

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(join(foreignDir, "omo"))
      expect(lines[0]).toContain("(unknown owner)")
      expect(lines[0]).toContain(`move ${sandbox.bunBin} ahead of ${foreignDir}`)
      expect(lines[0]).not.toContain(REPAIR)
    })
  })

  describe("#given a pre-rename Codex Light wrapper in ~/.local/bin ahead of omo-ai", () => {
    test("#then it is owned by lazycodex at the cached version and the installer repair is named", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const localBin = join(sandbox.home, ".local", "bin")
      const cli = join(sandbox.home, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "4.19.4", "dist", "cli", "index.js")
      writeFile(join(localBin, "omo"), `#!/bin/sh\n# OMO_GENERATED_RUNTIME_WRAPPER\nexec node "${cli}" "$@"\n`)

      const lines = report(sandbox, [localBin, sandbox.bunBin])

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("(lazycodex@4.19.4)")
      expect(lines[0]).toContain(REPAIR)
    })
  })

  describe("#given legacy omo entries only in relative and project node_modules/.bin PATH entries", () => {
    test("#then neither is scanned", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const project = join(sandbox.root, "project")
      installPackage(join(project, "node_modules"), join(project, "node_modules", ".bin"), "oh-my-openagent", "4.19.4")

      expect(report(sandbox, ["node_modules/.bin", join(project, "node_modules", ".bin"), sandbox.bunBin])).toEqual([])
    })
  })

  describe("#given the legacy package sits in the bun global tree", () => {
    test("#then the warning names bun remove and no npm restore note", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const modules = join(sandbox.bunRoot, "install", "global", "node_modules")
      installPackage(modules, sandbox.bunBin, "oh-my-opencode", "3.17.0", false)

      const lines = report(sandbox, [sandbox.bunBin])

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`(bun: ${join(modules, "oh-my-opencode")})`)
      expect(lines[0]).toContain("bun remove -g oh-my-opencode")
      expect(lines[0]).not.toContain(RESTORE)
    })
  })

  describe("#given an npm prefix that is only configured, not on PATH", () => {
    test("#then npm_config_prefix still finds the installed legacy package", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      installNpmLegacy(sandbox, "oh-my-opencode", false)

      const lines = report(sandbox, [sandbox.bunBin], { npm_config_prefix: sandbox.npmPrefix })

      expect(lines.filter((line) => line.startsWith("WARN legacy package oh-my-opencode@4.19.4"))).toHaveLength(1)
    })
  })

  describe("#given OpenCode config files still register the plugin", () => {
    test("#then one info line names every file, in JSONC and tuple form alike", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const configDir = join(sandbox.home, ".config", "opencode")
      writeFile(join(configDir, "opencode.jsonc"), [
        "{",
        "  // comment",
        "  \"$schema\": \"https://opencode.ai/config.json\",",
        "  /* block */ \"plugin\": [\"oh-my-openagent@beta\",],",
        "}",
      ].join("\n"))
      writeFile(join(configDir, "tui.json"), JSON.stringify({ plugin: [["oh-my-openagent/tui", {}]] }))

      const lines = report(sandbox, [sandbox.bunBin])

      expect(lines).toHaveLength(1)
      expect(lines[0]).toStartWith("INFO OpenCode still loads the oh-my-openagent plugin")
      expect(lines[0]).toContain(`${join(configDir, "opencode.jsonc")}, ${join(configDir, "tui.json")}`)
    })

    test("#then OPENCODE_CONFIG_DIR is read on top of the global config dir, as OpenCode layers it", () => {
      const sandbox = createSandbox()
      const globalConfig = join(sandbox.home, ".config", "opencode", "opencode.json")
      const configDir = join(sandbox.root, "custom-opencode")
      writeFile(globalConfig, JSON.stringify({ plugin: ["oh-my-opencode"] }))
      writeFile(join(configDir, "tui.json"), JSON.stringify({ plugin: ["oh-my-opencode/tui"] }))

      const lines = report(sandbox, [], { OPENCODE_CONFIG_DIR: configDir })

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`${globalConfig}, ${join(configDir, "tui.json")}`)
    })
  })

  describe("#given OpenCode config with only other plugins or a malformed file", () => {
    test("#then no info line is printed", () => {
      const sandbox = createSandbox()
      const configDir = join(sandbox.home, ".config", "opencode")
      writeFile(join(configDir, "opencode.json"), JSON.stringify({ plugin: ["oh-my-openagent-extras", "opencode-foo@1"] }))
      writeFile(join(configDir, "tui.json"), "{ not json")

      expect(report(sandbox, [])).toEqual([])
    })
  })

  describe("#given a sandbox with every leftover present", () => {
    test("#then the report leaves every file it read untouched", () => {
      const sandbox = createSandbox()
      installNpmLegacy(sandbox)
      installBunNative(sandbox)
      const opencodeConfig = join(sandbox.home, ".config", "opencode", "opencode.json")
      const original = JSON.stringify({ plugin: ["oh-my-openagent"] })
      writeFile(opencodeConfig, original)

      expect(report(sandbox, [sandbox.npmBin, sandbox.bunBin])).toHaveLength(3)

      expect(existsSync(join(sandbox.npmBin, "omo"))).toBe(true)
      expect(existsSync(join(sandbox.npmPrefix, "lib", "node_modules", "oh-my-openagent", "package.json"))).toBe(true)
      expect(readFileSync(opencodeConfig, "utf8")).toBe(original)
    })
  })

  describe("#given a clean sandbox with only omo-ai installed", () => {
    test("#then the migration section prints nothing", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      expect(report(sandbox, [sandbox.bunBin])).toEqual([])
    })
  })

  describe("#given runDoctor with an injected migration environment", () => {
    test("#then the migration lines follow the Update line", () => {
      const sandbox = createSandbox()
      installNpmLegacy(sandbox)
      installBunNative(sandbox)
      const output: string[] = []
      const originalLog = console.log
      const originalExitCode = process.exitCode
      console.log = (value?: unknown) => { output.push(String(value)) }
      try {
        runDoctor({ harnesses: [] }, [], {
          list: () => [],
          fetchDistTags: () => null,
          daemonReport: () => [],
          env: { PATH: [sandbox.npmBin, sandbox.bunBin].join(delimiter), BUN_INSTALL: sandbox.bunRoot },
          homeDir: sandbox.home,
          platform: "linux",
        })
      } finally {
        console.log = originalLog
        process.exitCode = originalExitCode ?? 0
      }

      const lines = output.join("\n").split("\n")
      const updateIndex = lines.indexOf(`INFO Update: ${updateTarget().command}`)
      expect(updateIndex).toBeGreaterThanOrEqual(0)
      expect(lines[updateIndex + 1]).toStartWith("WARN another omo precedes omo-ai on PATH:")
      expect(lines[updateIndex + 2]).toStartWith("WARN legacy package oh-my-openagent@4.19.4")
    })
  })

  describe("#given PATH dirs holding an omo that is not a regular file or symlink", () => {
    test("#then a directory named omo is not reported as a command", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const dirBin = join(sandbox.root, "dir-bin")
      mkdirSync(join(dirBin, "omo"), { recursive: true })

      expect(report(sandbox, [dirBin, sandbox.bunBin])).toEqual([])
    })

    test.skipIf(process.platform === "win32")("#then no FIFO is read and only the symlink occupying the name is reported", () => {
      const sandbox = createSandbox()
      const fifoBin = join(sandbox.root, "fifo-bin")
      const linkBin = join(sandbox.root, "link-bin")
      const opencodeConfig = join(sandbox.home, ".config", "opencode", "opencode.json")
      for (const directory of [fifoBin, linkBin, dirname(opencodeConfig)]) mkdirSync(directory, { recursive: true })
      for (const fifo of [join(fifoBin, "omo"), opencodeConfig]) expect(spawnSync("mkfifo", [fifo]).status).toBe(0)
      symlinkSync(join(fifoBin, "omo"), join(linkBin, "omo"))

      const child = spawnSync(process.execPath, ["-e", CHILD_REPORT], {
        env: { ...process.env, PROBE_PATH: [fifoBin, linkBin].join(delimiter), PROBE_HOME: sandbox.home, PROBE_BUN: sandbox.bunRoot },
        encoding: "utf8",
        timeout: 20000,
      })

      expect(child.signal).toBeNull()
      const lines: string[] = JSON.parse(child.stdout)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`${join(linkBin, "omo")} (unknown owner)`)
    }, 30000)
  })

  describe("#given a legacy omo reachable only through a relative PATH entry", () => {
    test("#then that entry is not scanned", () => {
      const sandbox = createSandbox()
      installNpmLegacy(sandbox)
      installBunNative(sandbox)

      expect(report(sandbox, [relative(process.cwd(), sandbox.npmBin), sandbox.bunBin])).toEqual([])
    })
  })

  describe("#given ~/.npmrc names an npm prefix under home that is not on PATH", () => {
    test("#then the legacy package installed there is still reported", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      const modules = join(sandbox.home, ".npm-global", "lib", "node_modules")
      installPackage(modules, join(sandbox.home, ".npm-global", "bin"), "oh-my-openagent", "4.19.4", false)
      writeFile(join(sandbox.home, ".npmrc"), "fund=false\nprefix = ~/.npm-global\n")

      const lines = report(sandbox, [sandbox.bunBin])

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`(npm: ${join(modules, "oh-my-openagent")})`)
    })
  })

  describe("#given one npm prefix reached through a symlinked npm_config_prefix and through PATH", () => {
    test("#then its legacy package is reported once", () => {
      const sandbox = createSandbox()
      installNpmLegacy(sandbox)
      installBunNative(sandbox)
      const alias = join(sandbox.root, "npm-alias")
      symlinkSync(sandbox.npmPrefix, alias)

      const lines = report(sandbox, [sandbox.bunBin, sandbox.npmBin], { npm_config_prefix: alias })

      expect(lines.filter((line) => line.startsWith("WARN legacy package"))).toHaveLength(1)
    })
  })

  describe("#given a global node_modules dir named like the legacy package but holding another manifest", () => {
    test("#then it is not reported", () => {
      const sandbox = createSandbox()
      installBunNative(sandbox)
      writeFile(
        join(sandbox.npmPrefix, "lib", "node_modules", "oh-my-openagent", "package.json"),
        JSON.stringify({ name: "oh-my-openagent-fork", version: "1.0.0" }),
      )

      expect(report(sandbox, [sandbox.bunBin], { npm_config_prefix: sandbox.npmPrefix })).toEqual([])
    })
  })
})
