import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bunBinShimScript, ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const POSIX_HOME = "/home/dev"
const roots: string[] = []

type Options = {
  scriptPath?: string
  env?: Record<string, string | undefined>
  homedir?: () => string
  platform?: string
  versions?: Record<string, string | undefined>
  exists?: (path: string) => boolean
  realpath?: (path: string) => string
  lstat?: (path: string) => { isSymbolicLink(): boolean; isFile(): boolean }
  readFile?: (path: string, encoding: "utf8") => string
  write?: (path: string, content: string, options: { mode: number }) => void
  rename?: (from: string, to: string) => void
  chmod?: (path: string, mode: number) => void
  pid?: number
  warn?: (message: string) => void
}

const identityRealpath = (path: string): string => path

function existsOnly(...present: string[]): (path: string) => boolean {
  const set = new Set(present)
  return (path) => set.has(path)
}

function bunTreePackage(bunRoot: string): string {
  return join(bunRoot, "install", "global", "node_modules", "omo-ai", "bin", "omo.js")
}

/** The stock shape bun links: a relative symlink from <root>/bin/omo into the global tree. */
function stockLinkTarget(): string {
  return join("..", "install", "global", "node_modules", "omo-ai", "bin", "omo.js")
}

/** Drives the unit surface with recorded filesystem operations, so no assertion touches the host. */
function recorder(files: Record<string, string> = {}) {
  const written: Array<{ path: string; content: string; mode: number }> = []
  const renamed: Array<{ from: string; to: string }> = []
  const chmodded: Array<{ path: string; mode: number }> = []
  const links = new Set<string>()
  return {
    written,
    renamed,
    chmodded,
    markLink: (path: string) => links.add(path),
    lstat: (path: string): { isSymbolicLink(): boolean; isFile(): boolean } => {
      if (!links.has(path) && !(path in files)) throw new Error(`ENOENT: ${path}`)
      return {
        isSymbolicLink: () => links.has(path),
        isFile: () => !links.has(path) && path in files,
      }
    },
    readFile: (path: string): string => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`)
      return files[path] ?? ""
    },
    write: (path: string, content: string, options: { mode: number }) => {
      written.push({ path, content, mode: options.mode })
      files[path] = content
    },
    rename: (from: string, to: string) => {
      renamed.push({ from, to })
      files[to] = files[from] ?? ""
      delete files[from]
    },
    chmod: (path: string, mode: number) => chmodded.push({ path, mode }),
  }
}

function baseInput(scriptPath: string, overrides: Partial<Options> = {}) {
  const bunRootDir = join(POSIX_HOME, ".bun")
  const bunPath = join(bunRootDir, "bin", "bun")
  const options: Required<Pick<Options, "scriptPath" | "env" | "homedir" | "platform" | "versions" | "exists" | "realpath">> = {
    scriptPath,
    env: {},
    homedir: () => POSIX_HOME,
    platform: "linux",
    versions: {},
    exists: existsOnly(bunPath),
    realpath: identityRealpath,
    pid: 4242,
    ...overrides,
  }
  return { options, bunRootDir, bunPath }
}

/** bun test runs on bun; node ships as its sibling on CI and dev machines, and its absence skips. */
function nodeInterpreter(): string | undefined {
  if (!process.versions.bun) return process.execPath
  const sibling = join(dirname(process.execPath), "node")
  if (existsSync(sibling)) return sibling
  const located = spawnSync("which", ["node"], { encoding: "utf8" })
  return located.status === 0 ? (located.stdout.split(/\r?\n/)[0]?.trim() || undefined) : undefined
}

const NODE = nodeInterpreter()
const POSIX_ONLY = process.platform === "win32" || !NODE
// The unit surface drives the module with `platform: "linux"`, so the module spells its paths with
// posix.join while the fixtures below spell theirs with the HOST's path.join. On Windows those two
// spellings never meet - `/home/dev/.bun/bin/bun` against `\home\dev\.bun\bin\bun` - and every
// lookup misses. Mirroring the module's own darwin/linux gate is the honest fix: the repair itself
// returns `skipped-platform` on Windows, so there is no Windows behaviour here left to cover.
const NON_POSIX_HOST = process.platform === "win32"

type Fixture = {
  root: string
  bunInstall: string
  packageRoot: string
  launcher: string
  binPath: string
  bunBinary: string
  captureFile: string
  markerFile: string
}

function fixtureEnv(fixture: Fixture, env: Record<string, string> = {}): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(fixture.root, "home"),
    BUN_INSTALL: fixture.bunInstall,
    // node's directory stays on PATH because the shim's fallbacks exec the entrypoint, whose
    // `#!/usr/bin/env node` line resolves node through PATH exactly as a real install would.
    PATH: `${dirname(NODE ?? process.execPath)}:/usr/bin:/bin`,
    CAPTURE_FILE: fixture.captureFile,
  }
  delete inherited.OMO_RUNTIME
  delete inherited.OMO_DEBUG
  delete inherited.OMO_CODING_AGENT_DIR
  delete inherited.SENPI_CODING_AGENT_DIR
  delete inherited.PI_CODING_AGENT_DIR
  return { ...inherited, ...env }
}

function createFixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-bin-shim-")))
  roots.push(root)
  const bunInstall = join(root, "buninstall")
  const packageRoot = join(bunInstall, "install", "global", "node_modules", "omo-ai")
  mkdirSync(join(packageRoot, "bin"), { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai",
    version: "9.9.9-test.0",
    type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  mkdirSync(join(senpiRoot, "dist"), { recursive: true })
  writeFileSync(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.8.9",
    type: "module",
    exports: { ".": "./dist/index.js" },
  }))
  writeFileSync(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  const captureFile = join(root, "capture.json")
  writeFileSync(join(senpiRoot, "dist", "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ argv: process.argv.slice(2), env: process.env, versions: process.versions }))
process.exit(Number(process.env.FAKE_EXIT ?? 0))
`)
  mkdirSync(join(senpiRoot, "dist", "core"), { recursive: true })
  writeFileSync(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  // A stand-in bun that proves it ran; the real bun end to end is QA's job against the real install.
  const markerFile = join(root, "fake-bun.marker")
  const bunBinary = join(bunInstall, "bin", "bun")
  mkdirSync(join(bunInstall, "bin"), { recursive: true })
  writeFileSync(bunBinary, `#!/bin/sh\nprintf fake-bun-ran > '${markerFile}'\nexit 42\n`, { mode: 0o755 })
  symlinkSync(stockLinkTarget(), join(bunInstall, "bin", "omo"))
  mkdirSync(join(root, "home"), { recursive: true })
  return {
    root,
    bunInstall,
    packageRoot,
    launcher: join(packageRoot, "bin", "omo.js"),
    binPath: join(bunInstall, "bin", "omo"),
    bunBinary,
    captureFile,
    markerFile,
  }
}

/** The pre-repair surface: node boots through the stock symlink, as the kernel does for `omo`. */
function launchViaNode(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  return spawnSync(NODE ?? process.execPath, [fixture.binPath, ...args], {
    encoding: "utf8",
    env: fixtureEnv(fixture, env),
  })
}

/** The post-repair surface: the kernel execs the shim's `#!/bin/sh` line; node is not involved. */
function launchShim(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  return spawnSync(fixture.binPath, args, { encoding: "utf8", env: fixtureEnv(fixture, env) })
}

/** A node boot of the entrypoint itself - the surface `OMO_RUNTIME=node` and updates land on. */
function launchEntry(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  return spawnSync(NODE ?? process.execPath, [fixture.launcher, ...args], {
    encoding: "utf8",
    env: fixtureEnv(fixture, env),
  })
}

function capture(fixture: Fixture): { argv: string[]; env: NodeJS.ProcessEnv; versions: Record<string, string | undefined> } {
  return JSON.parse(readFileSync(fixture.captureFile, "utf8"))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("bun launcher bin shim", () => {
  describe("#given the generated shim script", () => {
    test("#then it execs bun on the entrypoint and falls back to the entrypoint's own shebang", () => {
      // given
      const script = bunBinShimScript("/opt/x/bin/omo.js", "/home/dev/.bun/bin/bun")
      // when / then
      expect(script.split("\n")[0]).toBe("#!/bin/sh")
      expect(script).toContain(`exec '/home/dev/.bun/bin/bun' '/opt/x/bin/omo.js' "$@"`)
      // The fallback re-execs the entrypoint, whose `#!/usr/bin/env node` line is the exact path
      // the stock symlink used, so OMO_RUNTIME=node and a vanished bun both stay on node.
      expect(script.trimEnd().split("\n").at(-1)).toBe(`exec '/opt/x/bin/omo.js' "$@"`)
      expect(script).toContain(`if [ "$OMO_RUNTIME" != "node" ]`)
    })

    test("#then a path containing a single quote stays one shell word", () => {
      // given / when
      const script = bunBinShimScript("/opt/it's/bin/omo.js", "/home/dev/.bun/bin/bun")
      // then - the quoted form re-opens the string around the apostrophe; sh reassembles one word
      expect(script).toContain(`exec '/opt/it'\\''s/bin/omo.js' "$@"`)
    })
  })

  describe.skipIf(NON_POSIX_HOST)("#given a stock bun bin symlink pointing at this install", () => {
    test("#then it is replaced by an executable shim through an atomic rename", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        ...fs,
      })
      // then
      expect(result).toEqual({ action: "repaired" })
      expect(fs.written).toEqual([
        { path: `${binPath}.4242.tmp`, content: bunBinShimScript(scriptPath, bunPath), mode: 0o755 },
      ])
      expect(fs.renamed).toEqual([{ from: `${binPath}.4242.tmp`, to: binPath }])
      // writeFileSync applies umask, so the executable bit is pinned by an explicit follow-up chmod
      expect(fs.chmodded).toEqual([{ path: `${binPath}.4242.tmp`, mode: 0o755 }])
    })

    test("#then an already-current shim writes nothing", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const fs = recorder({ [join(bunRootDir, "bin", "omo")]: bunBinShimScript(scriptPath, bunPath) })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result).toEqual({ action: "current" })
      expect(fs.written).toHaveLength(0)
      expect(fs.renamed).toHaveLength(0)
    })

    test("#then a shim from an older generator version is rewritten", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder({
        [binPath]: `#!/bin/sh\n# omo-ai bun launcher shim v0 - older generator\nexec '${bunPath}' '${scriptPath}' "$@"\n`,
      })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result).toEqual({ action: "repaired" })
      expect(fs.written[0]?.content).toBe(bunBinShimScript(scriptPath, bunPath))
    })
  })

  describe.skipIf(NON_POSIX_HOST)("#given the bin path is not ours to touch", () => {
    test("#then a symlink into another package is left alone", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? "/usr/local/lib/node_modules/omo-ai/bin/omo.js" : path),
        ...fs,
      })
      // then
      expect(result).toEqual({ action: "foreign-link" })
      expect(fs.written).toHaveLength(0)
    })

    test("#then a file without the shim marker is left alone", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath)
      const fs = recorder({ [join(bunRootDir, "bin", "omo")]: "#!/bin/sh\nexec something-else\n" })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result).toEqual({ action: "foreign-file" })
      expect(fs.written).toHaveLength(0)
    })

    test("#then a missing bin path is a no-op, not a creation", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options } = baseInput(scriptPath)
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result).toEqual({ action: "absent-bin" })
      expect(fs.written).toHaveLength(0)
    })
  })

  describe("#given the launch context rules the repair out", () => {
    const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))

    test("#then Windows never repairs, whatever it finds", () => {
      // given
      const { options } = baseInput(scriptPath, { platform: "win32" })
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then - npm's .cmd/.ps1 shims exec the bin file through its shebang, so on Windows the file
      // must stay exactly what bun/npm linked
      expect(result).toEqual({ action: "skipped-platform" })
      expect(fs.written).toHaveLength(0)
    })

    test("#then a launcher already running on bun skips the check entirely", () => {
      // given
      const { options } = baseInput(scriptPath, { versions: { bun: "1.4.0" } })
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then - bun arrived through the shim already; the hot path pays nothing
      expect(result).toEqual({ action: "skipped-runtime" })
    })

    test("#then an npm-layout install skips the check entirely", () => {
      // given
      const { options } = baseInput("/usr/local/lib/node_modules/omo-ai/bin/omo.js")
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result).toEqual({ action: "skipped-install" })
    })

    test("#then a machine without bun has nothing to optimize with", () => {
      // given
      const { options } = baseInput(scriptPath, { exists: () => false })
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result).toEqual({ action: "skipped-no-bun" })
      expect(fs.written).toHaveLength(0)
    })
  })

  describe.skipIf(NON_POSIX_HOST)("#given the repair path fails", () => {
    test("#then the failure is swallowed and never breaks the launch", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      const failing = {
        ...fs,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        write: () => {
          throw new Error("EACCES: permission denied")
        },
      }
      // when
      const result = ensureBunBinShim({ ...options, ...failing })
      // then
      expect(result).toEqual({ action: "failed", error: "EACCES: permission denied" })
    })

    test("#then OMO_DEBUG narrates the swallowed failure", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath, { env: { OMO_DEBUG: "1" } })
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      const warnings: string[] = []
      const failing = {
        ...fs,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        write: () => {
          throw new Error("EROFS: read-only file system")
        },
        warn: (message: string) => warnings.push(message),
      }
      // when
      ensureBunBinShim({ ...options, ...failing })
      // then
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(binPath)
      expect(warnings[0]).toContain("EROFS")
    })
  })

  describe("#given a real synthetic bun global tree driven by node", () => {
    // The shim is a launch-surface artifact; its contract (what the kernel execs, which runtime
    // ends up running the engine, what a repair does to a live tree) is only honest when driven
    // through a real node process and a real exec. POSIX only: the shim is a POSIX feature and
    // creating the stock symlink needs privileges Windows CI does not grant.
    test.skipIf(POSIX_ONLY)("#then the first launch replaces the symlink and hands later launches to bun", () => {
      // given
      const fixture = createFixture()

      // when: the first launch happens through the stock symlink, exactly as a user types `omo`
      const first = launchViaNode(fixture, ["--version"])
      // then: the launch still answers (the re-exec hands it to the fixture's bun) and the bin is
      // now an executable, sh-valid shim carrying the freshly discovered bun path
      expect(first.status).toBe(42)
      expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      expect((statSync(fixture.binPath).mode & 0o111) !== 0).toBe(true)
      expect(readFileSync(fixture.binPath, "utf8")).toBe(bunBinShimScript(fixture.launcher, fixture.bunBinary))
      expect(spawnSync("/bin/sh", ["-n", fixture.binPath]).status).toBe(0)

      // when: the next launch execs the shim itself; node is not involved at all
      rmSync(fixture.markerFile)
      const second = launchShim(fixture, ["say", "hi"])
      // then: the shim's bun branch ran, and the engine was never reached
      expect(second.status).toBe(42)
      expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
      expect(existsSync(fixture.captureFile)).toBe(false)
    })

    test.skipIf(POSIX_ONLY)("#then OMO_RUNTIME=node stays on node end to end", () => {
      // given
      const fixture = createFixture()
      launchViaNode(fixture, ["--version"])

      // when: the shim itself runs with OMO_RUNTIME=node
      const result = launchShim(fixture, ["say", "hi"], { OMO_RUNTIME: "node" })
      // then: launcher AND engine both ran on node - the engine capture is the end-to-end proof
      expect(result.status).toBe(0)
      const captured = capture(fixture)
      expect(captured.env.SENPI_RUNTIME).toBe("node")
      expect(captured.versions.bun).toBeUndefined()
      expect(captured.argv).toContain("say")
    })

    test.skipIf(POSIX_ONLY)("#then a bun add -g update that restores the symlink is healed on the next launch", () => {
      // given
      const fixture = createFixture()
      launchViaNode(fixture, ["--version"])
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      // when: `bun add -g` rewrites the bin link over the shim (verified against real bun in QA)
      rmSync(fixture.binPath)
      symlinkSync(stockLinkTarget(), fixture.binPath)
      const healed = launchViaNode(fixture, ["--version"])
      // then
      expect(healed.status).toBe(42)
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      expect(readFileSync(fixture.binPath, "utf8")).toBe(bunBinShimScript(fixture.launcher, fixture.bunBinary))
    })

    test.skipIf(POSIX_ONLY)("#then a current shim is not rewritten by later node boots", () => {
      // given
      const fixture = createFixture()
      launchViaNode(fixture, ["--version"])
      // A rewrite would recreate the file with mode 0755, so dropping the executable bit makes
      // any rewrite observable without timing.
      chmodSync(fixture.binPath, 0o644)
      // when: a later node boot of the entrypoint runs the currency check
      const again = launchEntry(fixture, ["--version"], { OMO_RUNTIME: "node" })
      // then: it answered from the node path and left the shim untouched
      expect(again.status).toBe(0)
      expect(again.stdout.trim()).toBe("omo 9.9.9-test.0 (engine: senpi 2026.8.9)")
      expect(statSync(fixture.binPath).mode & 0o777).toBe(0o644)
    })

    test.skipIf(POSIX_ONLY)("#then an unwritable bin dir never breaks the launch", () => {
      // given
      const fixture = createFixture()
      chmodSync(join(fixture.bunInstall, "bin"), 0o555)
      try {
        // when: the repair cannot write, with node pinned so the re-exec cannot mask the failure
        const result = launchEntry(fixture, ["say", "hi"], { OMO_RUNTIME: "node" })
        // then: the launch completed, the engine ran, and the stock link is still there
        expect(result.status).toBe(0)
        expect(capture(fixture).env.SENPI_RUNTIME).toBe("node")
        expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(true)
      } finally {
        chmodSync(join(fixture.bunInstall, "bin"), 0o755)
      }
    })
  })
})
