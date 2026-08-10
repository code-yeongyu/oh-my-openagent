import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

type Fixture = {
  root: string
  packageRoot: string
  launcher: string
  captureFile: string
  shimPath?: string
}

function writeFile(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, mode === undefined ? undefined : { mode })
}

/**
 * Windows hands back the 8.3 short form (RUNNER~1) for a temp directory, and realpathSync does not
 * expand it, while the launcher reports the long form it derives from its own module URL. Resolving
 * through a file URL yields the same long spelling both sides use.
 */
function expandShortPath(path: string): string {
  if (process.platform !== "win32") return path
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function createFixture(options: { hoisted?: boolean; shim?: boolean } = {}): Fixture {
  // Windows hands back the 8.3 short form (RUNNER~1) here while the launcher reports the long path, so
  // the fixture root is canonicalized once and every derived path inherits the same spelling.
  const root = expandShortPath(realpathSync(mkdtempSync(join(tmpdir(), "omo-launcher-"))))
  roots.push(root)
  const packagePath = options.hoisted
    ? join(root, "node_modules", "omo-ai")
    : join(root, "app")
  mkdirSync(packagePath, { recursive: true })
  const packageRoot = expandShortPath(realpathSync(packagePath))
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai",
    version: "1.2.3-test.0",
    type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))

  const modulesRoot = options.hoisted ? join(root, "node_modules") : join(packageRoot, "node_modules")
  const senpiRoot = join(modulesRoot, "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.8.9",
    type: "module",
    exports: { ".": "./dist/index.js" },
  }))
  writeFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  writeFile(join(senpiRoot, "dist", "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ argv: process.argv.slice(2), env: process.env }))
if (process.env.FAKE_STDOUT) console.log(process.env.FAKE_STDOUT)
if (process.env.FAKE_SIGNAL) process.kill(process.pid, process.env.FAKE_SIGNAL)
process.exit(Number(process.env.FAKE_EXIT ?? 0))
`)

  let shimPath: string | undefined
  if (options.shim !== false) {
    shimPath = join(modulesRoot, ".bin", process.platform === "win32" ? "senpi.cmd" : "senpi")
    writeFile(shimPath, "fixture shim\n", 0o755)
    shimPath = expandShortPath(realpathSync(shimPath))
  }
  const toolkitRuntime = join(packageRoot, "plugin", "runtime", "agent-toolkit")
  writeFile(join(toolkitRuntime, "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ argv: process.argv.slice(2), target: "agent-toolkit" }))
process.exit(Number(process.env.FAKE_EXIT ?? 0))
`)
  writeFile(join(toolkitRuntime, "ulw-loop", "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ argv: process.argv.slice(2), target: "ulw-loop" }))
process.exit(Number(process.env.FAKE_EXIT ?? 0))
`)
  const captureFile = join(root, "capture.json")
  return { root, packageRoot, launcher: join(packageRoot, "bin", "omo.js"), captureFile, shimPath }
}

function run(fixture: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [fixture.launcher, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/usr/bin:/bin", CAPTURE_FILE: fixture.captureFile, ...env },
  })
}

function capture(fixture: Fixture): { argv: string[]; env: NodeJS.ProcessEnv; target?: string } {
  return JSON.parse(readFileSync(fixture.captureFile, "utf8"))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo launcher", () => {
  describe("#given a fake senpi package", () => {
    describe("#when the default command is launched", () => {
      test("#then the packaged extension precedes user extension arguments", () => {
        const fixture = createFixture()
        const result = run(fixture, ["say", "hi", "-e", "/user/plugin"])
        expect(result.status).toBe(0)
        expect(capture(fixture).argv).toEqual([
          "--extension", join(fixture.packageRoot, "plugin"), "say", "hi", "-e", "/user/plugin",
        ])
      })

      test("#then launcher environment points to existing hoisted shims", () => {
        const fixture = createFixture({ hoisted: true })
        mkdirSync(join(fixture.packageRoot, "node_modules"), { recursive: true })
        const result = run(fixture, ["say", "hi"], { OMO_BIN: "/must/not/leak" })
        const environment = capture(fixture).env
        expect(result.status).toBe(0)
        expect(environment.SENPI_BIN).toBe(fixture.shimPath)
        expect(existsSync(environment.SENPI_BIN ?? "")).toBe(true)
        const path = Object.entries(environment).find(([key]) => key.toLowerCase() === "path")?.[1]
        const binDir = path?.split(process.platform === "win32" ? ";" : ":")[0]
        expect(binDir).toBeDefined()
        expect(realpathSync.native(binDir ?? "")).toBe(realpathSync.native(dirname(fixture.shimPath ?? "")))
        expect(existsSync(binDir ?? "")).toBe(true)
        expect(environment.OMO_AGENT_TOOLKIT_BIN).toBe(join(fixture.packageRoot, "bin", "omo-agent-toolkit.js"))
        // An inherited value must never survive; it is replaced by this launcher's own entry so
        // anything resolving the product by name re-enters here instead of the bare engine.
        // Windows reports this path in its long form while the fixture root may be the 8.3 short
        // form, so the contract is asserted by target rather than by exact spelling.
        expect(existsSync(environment.OMO_BIN ?? "")).toBe(true)
        expect((environment.OMO_BIN ?? "").replace(/\\/g, "/")).toMatch(/\/bin\/omo\.js$/)
        expect(environment.OMO_BIN).not.toBe(environment.SENPI_BIN)
      })

      test("#then SENPI_BIN stays absent when no shim exists", () => {
        const fixture = createFixture({ shim: false })
        const result = run(fixture, ["say", "hi"], { SENPI_BIN: "/stale/senpi" })
        expect(result.status).toBe(0)
        expect(capture(fixture).env.SENPI_BIN).toBeUndefined()
      })
    })


    describe("#when the product identity is handed to the engine", () => {
      test("#then the brand profile names the product, its flat home and its update channel", () => {
        const fixture = createFixture()
        const result = run(fixture, ["say", "hi"])
        expect(result.status).toBe(0)

        const brand = JSON.parse(capture(fixture).env.SENPI_BRAND ?? "{}")
        expect(brand.name).toBe("omo")
        expect(brand.configDir).toBe(".omo")
        expect(brand.flatLayout).toBe(true)
        expect(brand.envPrefix).toBe("OMO")
        expect(brand.userAgent).toBe("omo")
        expect(brand.originator).toBe("omo")
        expect(brand.displayVersion).toBe("1.2.3-test.0")
        expect(brand.update).toEqual({
          packageName: "omo-ai",
          distTag: "beta",
          command: "npm i -g omo-ai@beta",
          changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
        })
      })

      test("#then OMO_BIN names this launcher, so the product never resolves to the bare engine", () => {
        const fixture = createFixture({ hoisted: true })
        mkdirSync(join(fixture.packageRoot, "node_modules"), { recursive: true })
        const result = run(fixture, ["say", "hi"])
        expect(result.status).toBe(0)
        const omoBin = capture(fixture).env.OMO_BIN ?? ""
        expect(existsSync(omoBin)).toBe(true)
        expect(omoBin.replace(/\\/g, "/")).toMatch(/\/bin\/omo\.js$/)
      })
    })

    describe("#when the version is requested on its own", () => {
      test("#then the product version is reported with its engine version, without spawning senpi", () => {
        const fixture = createFixture()
        const result = run(fixture, ["--version"])
        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe("omo 1.2.3-test.0 (engine: senpi 2026.8.9)")
        expect(existsSync(fixture.captureFile)).toBe(false)
      })

      test("#then a compound invocation still reaches senpi", () => {
        const fixture = createFixture()
        const result = run(fixture, ["--version", "--print"])
        expect(result.status).toBe(0)
        expect(capture(fixture).argv).toContain("--version")
      })
    })

    describe("#when a self-update is requested", () => {
      for (const args of [["update", "--self"], ["update", "self"], ["update", "senpi"]]) {
        test(`#then ${args.join(" ")} is answered with the product's own update command`, () => {
          const fixture = createFixture()
          const result = run(fixture, args)
          expect(result.status).toBe(0)
          expect(result.stdout).toContain("npm i -g omo-ai@beta")
          expect(existsSync(fixture.captureFile)).toBe(false)
        })
      }

      test("#then updating extensions still passes through to senpi", () => {
        const fixture = createFixture()
        const result = run(fixture, ["update", "--extensions"])
        expect(result.status).toBe(0)
        expect(capture(fixture).argv).toEqual(["update", "--extensions"])
      })
    })

    describe("#when an early senpi command is launched", () => {
      for (const [label, args] of [
        ["install", ["install", "source"]], ["remove", ["remove", "source"]],
        ["list", ["list"]], ["config", ["config"]], ["auth", ["auth", "login"]],
        ["app-server", ["app-server"]], ["update with flags", ["update", "--extensions"]],
        ["update with a source", ["update", "source"]],
      ] as const) {
        test(`#then ${label} passes through without an extension argument`, () => {
          const fixture = createFixture()
          const result = run(fixture, [...args])
          const captured = capture(fixture)
          expect(result.status).toBe(0)
          expect(captured.argv).toEqual([...args])
          expect(captured.argv).not.toContain("--extension")
          expect(existsSync(captured.env.SENPI_BIN ?? "")).toBe(true)
          expect(captured.env.OMO_AGENT_TOOLKIT_BIN).toBe(join(fixture.packageRoot, "bin", "omo-agent-toolkit.js"))
          expect((captured.env.OMO_BIN ?? "").replace(/\\/g, "/")).toMatch(/\/bin\/omo\.js$/)
        })
      }
    })

    describe("#when bare update is requested", () => {
      test("#then npm beta guidance is printed without spawning senpi", () => {
        const fixture = createFixture()
        const result = run(fixture, ["update"])
        expect(result.status).toBe(0)
        expect(result.stdout).toContain("omo is updated via npm: npm i -g omo-ai@beta")
        expect(existsSync(fixture.captureFile)).toBe(false)
      })
    })

    describe("#when ulw-loop is requested", () => {
      test("#then the staged runtime CLI receives the remaining arguments", () => {
        const fixture = createFixture()
        const result = run(fixture, ["ulw-loop", "status", "--json"])
        expect(result.status).toBe(0)
        expect(capture(fixture)).toMatchObject({ argv: ["status", "--json"], target: "ulw-loop" })
      })
    })

    describe("#when the committed agent-toolkit delegate is launched", () => {
      test("#then the staged dispatcher receives all arguments", () => {
        const fixture = createFixture()
        const result = spawnSync(process.execPath, [
          join(fixture.packageRoot, "bin", "omo-agent-toolkit.js"), "ulw-loop", "status",
        ], {
          encoding: "utf8",
          env: { ...process.env, CAPTURE_FILE: fixture.captureFile },
        })
        expect(result.status).toBe(0)
        expect(capture(fixture)).toMatchObject({ argv: ["ulw-loop", "status"], target: "agent-toolkit" })
      })
    })

    describe("#when the child terminates", () => {
      test("#then exit zero and exit seven propagate", () => {
        const fixture = createFixture()
        expect(run(fixture, ["list"], { FAKE_EXIT: "0" }).status).toBe(0)
        expect(run(fixture, ["list"], { FAKE_EXIT: "7" }).status).toBe(7)
      })

      // Windows has no POSIX signal delivery, so a terminated child reports a null signal there and the
      // launcher has nothing to re-raise.
      test.skipIf(process.platform === "win32")("#then SIGINT is re-raised by the launcher", () => {
        const fixture = createFixture()
        const result = run(fixture, ["list"], { FAKE_SIGNAL: "SIGINT" })
        expect(result.signal).toBe("SIGINT")
      })

      test("#then child stdio remains inherited", () => {
        const fixture = createFixture()
        const result = run(fixture, ["list"], { FAKE_STDOUT: "fixture-stdio" })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain("fixture-stdio")
      })
    })

    describe("#given the senpi CLI is missing", () => {
      test("#then resolution fails with actionable reinstall guidance", () => {
        const fixture = createFixture()
        rmSync(join(fixture.packageRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js"))
        const result = run(fixture, ["say", "hi"])
        expect(result.status).toBe(1)
        expect(result.stderr).toContain("reinstall with: npm i -g omo-ai@beta")
      })

      test("#then a missing dependency fails with the same reinstall guidance", () => {
        const fixture = createFixture()
        rmSync(join(fixture.packageRoot, "node_modules", "@code-yeongyu", "senpi"), { recursive: true })
        const result = run(fixture, ["say", "hi"])
        expect(result.status).toBe(1)
        expect(result.stderr).toContain("could not resolve @code-yeongyu/senpi")
        expect(result.stderr).toContain("reinstall with: npm i -g omo-ai@beta")
      })
    })
  })
})
