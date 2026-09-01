import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { updateTarget } from "../bin/lib/package-paths.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

type Fixture = {
  root: string
  packageRoot: string
  launcher: string
  captureFile: string
  shimPath?: string
}

type InstallLayout = "bun" | "bun-legacy" | "bun-posix-special" | "npm" | "unknown"

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

function createFixture(options: { hoisted?: boolean; shim?: boolean; installLayout?: InstallLayout } = {}): Fixture {
  // Windows hands back the 8.3 short form (RUNNER~1) here while the launcher reports the long path, so
  // the fixture root is canonicalized once and every derived path inherits the same spelling.
  const root = expandShortPath(realpathSync(mkdtempSync(join(tmpdir(), "omo-launcher-"))))
  roots.push(root)
  const packagePath = options.installLayout === "bun-legacy"
    ? join(root, "home", "node_modules", "omo-ai")
    : options.installLayout?.startsWith("bun")
    ? join(
      root,
      options.installLayout === "bun-posix-special"
        ? "custom $HOME's bun"
        : "custom-bun",
      "install",
      "global",
      "node_modules",
      "omo-ai",
    )
    : options.installLayout === "npm"
      ? join(root, "prefix", "lib", "node_modules", "omo-ai")
      : options.hoisted
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
  if (options.installLayout === "npm") {
    writeFile(join(root, "prefix", "lib", "node_modules", ".package-lock.json"), "{}\n")
  }

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
  writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")

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
  // A developer machine exports the agent directory for its own install; inheriting it would let
  // the override path answer assertions that are about the unconfigured default.
  const inherited: NodeJS.ProcessEnv = { ...process.env, PATH: "/usr/bin:/bin", CAPTURE_FILE: fixture.captureFile }
  delete inherited.OMO_CODING_AGENT_DIR
  delete inherited.SENPI_CODING_AGENT_DIR
  delete inherited.PI_CODING_AGENT_DIR
  return spawnSync(process.execPath, [fixture.launcher, ...args], {
    encoding: "utf8",
    env: { ...inherited, ...env },
  })
}

function capture(fixture: Fixture): { argv: string[]; env: NodeJS.ProcessEnv; target?: string } {
  return JSON.parse(readFileSync(fixture.captureFile, "utf8"))
}

/**
 * Resolves a real interpreter for the runtime under test. `bun test` runs on bun and node ships as
 * a sibling of it (and vice versa), but neither is guaranteed, so a missing interpreter skips its
 * case rather than failing on the host's toolchain.
 */
function runtimeInterpreter(runtime: "node" | "bun"): string | undefined {
  const current = runtime === "bun" ? Boolean(process.versions.bun) : !process.versions.bun
  if (current) return process.execPath
  const name = process.platform === "win32" ? `${runtime}.exe` : runtime
  const sibling = join(dirname(process.execPath), name)
  if (existsSync(sibling)) return sibling
  const located = spawnSync(process.platform === "win32" ? "where" : "which", [runtime], { encoding: "utf8" })
  const resolved = located.status === 0 ? located.stdout.split(/\r?\n/)[0]?.trim() : undefined
  return resolved ? resolved : undefined
}

function expectedBunUpdateCommand(packageRoot: string): string {
  const quotedRoot = process.platform === "win32"
    ? `"${packageRoot.replaceAll("\\", "/")}"`
    : `'${packageRoot.replaceAll("'", "'\\''")}'`
  return `omo is updated via bun: bun add --cwd ${quotedRoot} -g omo-ai@beta`
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
        const home = join(fixture.root, "home")
        mkdirSync(join(fixture.packageRoot, "node_modules"), { recursive: true })
        const result = run(fixture, ["say", "hi"], { HOME: home, OMO_BIN: "/must/not/leak" })
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
        expect(environment.OMO_CODING_AGENT_DIR).toBe(join(home, ".omo", "agent"))
        expect(environment.SENPI_CODING_AGENT_DIR).toBe(join(home, ".omo", "agent"))
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
      test("#then the brand profile names the product, its home and its update channel", () => {
        const fixture = createFixture()
        const result = run(fixture, ["say", "hi"])
        expect(result.status).toBe(0)

        const brand = JSON.parse(capture(fixture).env.SENPI_BRAND ?? "{}")
        expect(brand.name).toBe("OmO")
        expect(brand.command).toBe("omo")
        expect(brand.configDir).toBe(".omo")
        expect(brand.flatLayout).toBe(false)
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

      // The launcher may re-exec itself under bun; whichever runtime wins, the engine must be told
      // about it so it never flips back and spawns a second interpreter of its own. Both spellings
      // are driven through a real interpreter, because the value has to track the process that
      // actually runs the launcher rather than a constant either side could drift away from.
      for (const runtime of ["node", "bun"] as const) {
        const interpreter = runtimeInterpreter(runtime)
        // Skipping is visible in the report; silently passing on a host without the interpreter
        // would let the contract rot unnoticed.
        test.skipIf(!interpreter)(`#then a launcher running on ${runtime} tells the engine SENPI_RUNTIME=${runtime}`, () => {
          const fixture = createFixture()
          // OMO_RUNTIME pins the decision, so this asserts the reported value and never depends on
          // whether the host happens to have omo installed in a bun global tree.
          const result = spawnSync(interpreter ?? process.execPath, [fixture.launcher, "say", "hi"], {
            encoding: "utf8",
            env: {
              ...process.env,
              CAPTURE_FILE: fixture.captureFile,
              OMO_RUNTIME: runtime,
            },
          })
          expect(result.status).toBe(0)
          expect(capture(fixture).env.SENPI_RUNTIME).toBe(runtime)
        })
      }

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

      test("#then a Bun-managed install uses a clean package cwd", () => {
        const fixture = createFixture({ installLayout: "bun" })
        const result = run(fixture, ["update"])

        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe(expectedBunUpdateCommand(fixture.packageRoot))
        expect(existsSync(fixture.captureFile)).toBe(false)
      })

      test("#then a Bun path with shell metacharacters is quoted for the host", () => {
        const fixture = createFixture({ installLayout: "bun-posix-special" })
        const result = run(fixture, ["update"])

        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe(expectedBunUpdateCommand(fixture.packageRoot))
      })

      test("#then a Windows-style Bun path uses shell-compatible forward slashes", () => {
        const root = String.raw`C:\Users\omo user\.bun\install\global\node_modules\omo-ai`

        expect(updateTarget(root, "win32")).toEqual({
          manager: "bun",
          command: "bun add --cwd \"C:/Users/omo user/.bun/install/global/node_modules/omo-ai\" -g omo-ai@beta",
        })
      })

      test("#then an npm-managed install keeps the npm update command", () => {
        const fixture = createFixture({ installLayout: "npm" })
        const result = run(fixture, ["update"])

        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe("omo is updated via npm: npm i -g omo-ai@beta")
        expect(existsSync(fixture.captureFile)).toBe(false)
      })

      test("#then an unknown install layout fails safe to npm", () => {
        const fixture = createFixture({ installLayout: "unknown" })
        const result = run(fixture, ["update"])

        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe("omo is updated via npm: npm i -g omo-ai@beta")
        expect(existsSync(fixture.captureFile)).toBe(false)
      })
    })

    describe("#given a legacy Bun global manifest contains the empty dot dependency", () => {
      test("#then launching omo removes only the invalid dependency entry", () => {
        const fixture = createFixture({ installLayout: "bun-legacy" })
        const home = join(fixture.root, "home")
        const manifestPath = join(home, "package.json")
        writeFile(manifestPath, JSON.stringify({
          dependencies: {
            "": ".",
            "left-pad": "1.3.0",
          },
        }))

        const result = run(fixture, ["--version"], { HOME: home })

        expect(result.status).toBe(0)
        expect(JSON.parse(readFileSync(manifestPath, "utf8")).dependencies).toEqual({
          "left-pad": "1.3.0",
        })
      })

      test("#then a different empty dependency value is preserved", () => {
        const fixture = createFixture({ installLayout: "bun-legacy" })
        const home = join(fixture.root, "home")
        const manifestPath = join(home, "package.json")
        const original = `${JSON.stringify({ dependencies: { "": "file:.", "left-pad": "1.3.0" } }, null, 2)}\n`
        writeFile(manifestPath, original)

        const result = run(fixture, ["--version"], { HOME: home })

        expect(result.status).toBe(0)
        expect(readFileSync(manifestPath, "utf8")).toBe(original)
      })

      test("#then malformed JSON is preserved", () => {
        const fixture = createFixture({ installLayout: "bun-legacy" })
        const home = join(fixture.root, "home")
        const manifestPath = join(home, "package.json")
        const original = "{ not-json\n"
        writeFile(manifestPath, original)

        const result = run(fixture, ["--version"], { HOME: home })

        expect(result.status).toBe(0)
        expect(readFileSync(manifestPath, "utf8")).toBe(original)
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
