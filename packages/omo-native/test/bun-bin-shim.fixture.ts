import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stockLinkTarget } from "./bun-bin-shim.test-support"

export const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

/** bun test runs on bun; node ships as its sibling on CI and dev machines, and its absence skips. */
function nodeInterpreter(): string | undefined {
  if (!process.versions.bun) return process.execPath
  const sibling = join(dirname(process.execPath), "node")
  if (existsSync(sibling)) return sibling
  const located = spawnSync("which", ["node"], { encoding: "utf8" })
  return located.status === 0 ? (located.stdout.split(/\r?\n/)[0]?.trim() || undefined) : undefined
}

export const NODE = nodeInterpreter()
export const POSIX_ONLY = process.platform === "win32" || !NODE

// The system dirs a node-less PATH keeps (`sh` lives there). A host that ships node in them cannot
// stage a machine without node, so that case skips instead of passing on the wrong runtime.
const NODELESS_SYSTEM_DIRS = "/bin"
export const NODELESS_UNAVAILABLE = process.platform === "win32"
  || !process.versions.bun
  || spawnSync("/usr/bin/env", ["node", "--version"], { env: { PATH: NODELESS_SYSTEM_DIRS } }).status === 0

export type Fixture = {
  root: string
  bunInstall: string
  packageRoot: string
  launcher: string
  binPath: string
  bunBinary: string
  captureFile: string
  markerFile: string
}

export function fixtureEnv(fixture: Fixture, env: Record<string, string> = {}): NodeJS.ProcessEnv {
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

export function createFixture(): Fixture {
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
export function launchViaNode(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  return spawnSync(NODE ?? process.execPath, [fixture.binPath, ...args], {
    encoding: "utf8",
    env: fixtureEnv(fixture, env),
  })
}

/** The post-repair surface: the kernel execs the shim's `#!/bin/sh` line; node is not involved. */
export function launchShim(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  return spawnSync(fixture.binPath, args, { encoding: "utf8", env: fixtureEnv(fixture, env) })
}

/** A node boot of the entrypoint itself - the surface `OMO_RUNTIME=node` and updates land on. */
export function launchEntry(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
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
export function stageInstalledPackage(fixture: Fixture): void {
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
export function nodelessEnv(fixture: Fixture): NodeJS.ProcessEnv {
  const pathDir = join(fixture.root, "nodeless-path")
  mkdirSync(pathDir, { recursive: true })
  symlinkSync(process.execPath, join(pathDir, "bun"))
  const env = fixtureEnv(fixture, { PATH: `${pathDir}:${NODELESS_SYSTEM_DIRS}` })
  // A parent package script exports these; with either one set, `bun run` stops supplying its own
  // `node` to the scripts it runs, so the node-less machine this stages would not be node-less (#10419).
  delete env.NODE
  delete env.npm_node_execpath
  return env
}

export function capture(fixture: Fixture): { argv: string[]; env: NodeJS.ProcessEnv; versions: Record<string, string | undefined> } {
  return JSON.parse(readFileSync(fixture.captureFile, "utf8"))
}

/** Removes every fixture root created since the last call; each test file runs it in afterEach. */
export function removeFixtureRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}
