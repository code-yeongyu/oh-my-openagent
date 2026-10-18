import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bunBinShimScript, ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"
import {
  baseInput,
  bunTreePackage,
  NON_POSIX_HOST,
  POSIX_HOME,
  recorder,
  stockLinkTarget,
} from "./bun-bin-shim.test-support"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

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

// The system dirs a node-less PATH keeps (`sh` lives there). A host that ships node in them cannot
// stage a machine without node, so that case skips instead of passing on the wrong runtime.
const NODELESS_SYSTEM_DIRS = "/bin"
const NODELESS_UNAVAILABLE = process.platform === "win32"
  || !process.versions.bun
  || spawnSync("/usr/bin/env", ["node", "--version"], { env: { PATH: NODELESS_SYSTEM_DIRS } }).status === 0

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
  // It answers `--version` like a real bun at the engine's floor, because the launcher probes the
  // bun a bun-global install chose before trusting it (#9563).
  const markerFile = join(root, "fake-bun.marker")
  const bunBinary = join(bunInstall, "bin", "bun")
  mkdirSync(join(bunInstall, "bin"), { recursive: true })
  writeFileSync(bunBinary, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.2; exit 0; fi\nprintf fake-bun-ran > '${markerFile}'\nexit 42\n`, { mode: 0o755 })
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

/**
 * Turns the fixture into what `bun add -g` leaves behind before it runs the package's own scripts:
 * the real postinstall line, and an engine tree that postinstall can prepare (the RPC serializer it
 * patches comes from the installed engine and the pi-ai file it floors is bundled, as in
 * senpi-patch.test.ts).
 */
function stageInstalledPackage(fixture: Fixture): void {
  const manifestPath = join(fixture.packageRoot, "package.json")
  const shipped = JSON.parse(readFileSync(join(SOURCE_ROOT, "package.json"), "utf8"))
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, scripts: { postinstall: shipped.scripts.postinstall } }))
  const senpiRoot = join(fixture.packageRoot, "node_modules", "@code-yeongyu", "senpi")
  const rpcMode = join(senpiRoot, "dist", "modes", "rpc", "rpc-mode.js")
  mkdirSync(dirname(rpcMode), { recursive: true })
  writeFileSync(rpcMode, readFileSync(new URL("./modes/rpc/rpc-mode.js", import.meta.resolve("@code-yeongyu/senpi")), "utf8"))
  const anthropicMessages = join(senpiRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "api", "anthropic-messages.js")
  mkdirSync(dirname(anthropicMessages), { recursive: true })
  writeFileSync(anthropicMessages, 'const claudeCodeVersion = "2.1.75";\nexport { claudeCodeVersion }\n')
}

/** A PATH that reaches bun and the system shell but no node, like a launchd job or a bun-only box. */
function nodelessEnv(fixture: Fixture): NodeJS.ProcessEnv {
  const pathDir = join(fixture.root, "nodeless-path")
  mkdirSync(pathDir, { recursive: true })
  symlinkSync(process.execPath, join(pathDir, "bun"))
  return fixtureEnv(fixture, { PATH: `${pathDir}:${NODELESS_SYSTEM_DIRS}` })
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
    test("#then a launch running on bun repairs it too (#9293)", () => {
      // given: bun is the runtime - bun's postinstall on a machine without node, or `bun omo.js`
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath, { versions: { bun: "1.4.2" } })
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
      expect(result.action).toBe("repaired")
      expect(fs.written[0]?.content).toBe(bunBinShimScript(scriptPath, bunPath))
    })

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
      expect(result.action).toBe("repaired")
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
      expect(result.action).toBe("current")
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
      expect(result.action).toBe("repaired")
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
      expect(result.action).toBe("foreign-link")
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
      expect(result.action).toBe("foreign-file")
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
      expect(result.action).toBe("absent-bin")
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
      expect(result.action).toBe("skipped-platform")
      expect(fs.written).toHaveLength(0)
    })

    test("#then an npm-layout install skips the check entirely", () => {
      // given
      const { options } = baseInput("/usr/local/lib/node_modules/omo-ai/bin/omo.js")
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("skipped-install")
    })

    test("#then a machine without bun has nothing to optimize with", () => {
      // given
      const { options } = baseInput(scriptPath, { exists: () => false })
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("skipped-no-bun")
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
      expect(result.action).toBe("failed")
      expect(result.error).toBe("EACCES: permission denied")
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

  describe("#given a bun add -g update on a machine without node (#9293)", () => {
    test.skipIf(NODELESS_UNAVAILABLE)("#then bun's postinstall leaves an omo that starts without node", () => {
      // given: the tree `bun add -g` just linked - its bin is the stock symlink to the entrypoint,
      // whose `#!/usr/bin/env node` cannot start where node is not on PATH
      const fixture = createFixture()
      stageInstalledPackage(fixture)
      const env = nodelessEnv(fixture)
      const stock = spawnSync(fixture.binPath, ["--version"], { encoding: "utf8", env })
      expect(stock.status).toBe(127)

      // when: bun runs the package's postinstall right after linking; with no node on PATH, bun
      // runs the script's `node` itself
      const postinstall = spawnSync(process.execPath, ["run", "postinstall"], {
        cwd: fixture.packageRoot,
        encoding: "utf8",
        env,
      })

      // then: the bin is the shim again, and `omo` starts on bun with the same node-less PATH
      expect(postinstall.status).toBe(0)
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      expect(readFileSync(fixture.binPath, "utf8")).toBe(bunBinShimScript(fixture.launcher, fixture.bunBinary))
      const launched = spawnSync(fixture.binPath, ["--version"], { encoding: "utf8", env })
      expect(launched.status).toBe(42)
      expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
    })
  })
})
