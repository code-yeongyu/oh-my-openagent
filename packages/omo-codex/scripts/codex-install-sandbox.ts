import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"

import type { CodexCleanupOptions } from "../src/install/codex-cleanup"
import type { CodexInstallOptions } from "../src/install/types"

// One temp root per test that owns every path the Codex installer and cleanup can resolve (#13253). The installer
// falls back to the real home (CODEX_HOME, ~/.codex, ~/.local/bin, CODEX_LOCAL_BIN_DIR, OMO_CODEX_PROJECT, the working
// directory), so a test that leaves one of those to the environment can write or delete outside its scratch directory.
// options() and spawnEnv() refuse, before anything runs, a path that is missing or outside the root. The node-run
// tests import this module through install-test-fixtures.mjs (node 24 strips the types).
const SANDBOX_PATH_ENV = [
  "HOME",
  "USERPROFILE",
  "CODEX_HOME",
  "CODEX_LOCAL_BIN_DIR",
  "OMO_CODEX_PROJECT",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_BIN_HOME",
] as const
// What a spawned child needs from the parent to start at all; nothing a path is resolved from.
const SPAWN_ESSENTIALS = ["PATH", "SystemRoot", "SYSTEMROOT", "ComSpec", "PATHEXT", "windir", "LANG"] as const

type SandboxEnv = Readonly<Record<string, string | undefined>>
export type CodexSandboxOptions = CodexInstallOptions & CodexCleanupOptions & { readonly env: NodeJS.ProcessEnv }
type CodexSandboxOverrides = CodexInstallOptions & CodexCleanupOptions & { readonly withoutBinDir?: boolean }

export interface CodexInstallSandbox {
  readonly root: string
  readonly home: string
  readonly codexHome: string
  readonly binDir: string
  readonly projectDirectory: string
  readonly env: Readonly<Record<string, string>>
  path(...parts: readonly string[]): string
  dir(...parts: readonly string[]): string
  options(overrides?: CodexSandboxOverrides): CodexSandboxOptions
  spawnEnv(overrides?: SandboxEnv): Record<string, string>
  dispose(): void
}

function requireInside(root: string, what: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`codex install sandbox: ${what} is missing; the installer would fall back to a real path`)
  const path = resolve(value)
  if (path !== root && !path.startsWith(root + sep))
    throw new Error(`codex install sandbox: ${what} ${path} is outside ${root}`)
}

function assertSandboxEnv(root: string, env: SandboxEnv, skip: ReadonlySet<string> = new Set()): void {
  for (const key of SANDBOX_PATH_ENV) if (!skip.has(key)) requireInside(root, `env.${key}`, env[key])
}

function assertInsideSandbox(root: string, options: CodexSandboxOptions, withoutBinDir: boolean): void {
  requireInside(root, "options.codexHome", options.codexHome)
  requireInside(root, "options.projectDirectory", options.projectDirectory)
  // Without a bin dir option the installer takes CODEX_LOCAL_BIN_DIR, else a recorded or derived directory under
  // codexHome; the env value is checked when present, the others live under the checked codexHome.
  const unset = withoutBinDir && options.env["CODEX_LOCAL_BIN_DIR"] === undefined
  assertSandboxEnv(root, options.env, unset ? new Set(["CODEX_LOCAL_BIN_DIR"]) : new Set())
  if (!withoutBinDir) requireInside(root, "options.binDir", options.binDir)
  else if (options.binDir !== undefined) throw new Error("codex install sandbox: withoutBinDir with a binDir option")
}

const liveSandboxRoots = new Set<string>()

// Removes every sandbox root created so far; register it with afterEach so no test leaves its root behind.
export function disposeCodexInstallSandboxes(): void {
  for (const root of liveSandboxRoots) rmSync(root, { recursive: true, force: true })
  liveSandboxRoots.clear()
}

export function createCodexInstallSandbox(name = "sandbox"): CodexInstallSandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `omo-codex-${name}-`)))
  liveSandboxRoots.add(root)
  const home = join(root, "home")
  const codexHome = join(home, ".codex")
  const binDir = join(root, "bin")
  const projectDirectory = join(root, "project")
  const tmp = join(root, "tmp")
  // The project-local cleanup walks up to the first .git, so the project directory carries one and the walk ends here.
  for (const directory of [codexHome, binDir, join(projectDirectory, ".git"), tmp])
    mkdirSync(directory, { recursive: true })
  const env: Readonly<Record<string, string>> = Object.freeze({
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CODEX_LOCAL_BIN_DIR: binDir,
    OMO_CODEX_PROJECT: projectDirectory,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_BIN_HOME: join(home, ".local", "bin"),
    // The product's documented telemetry opt-out: an installer run under the sandbox sends no install event.
    DO_NOT_TRACK: "1",
  })
  const path = (...parts: readonly string[]): string => {
    const target = resolve(root, ...parts)
    requireInside(root, "path", target)
    return target
  }
  return {
    root,
    home,
    codexHome,
    binDir,
    projectDirectory,
    env,
    path,
    dir(...parts) {
      const target = path(...parts)
      mkdirSync(target, { recursive: true })
      return target
    },
    // Installer and cleanup options. withoutBinDir: true leaves the binDir option out (and CODEX_LOCAL_BIN_DIR unless the
    // test sets it) for a test of how the installer finds its bin dir; every path it can then use is still checked.
    options(overrides = {}) {
      const { withoutBinDir = false, ...rest } = overrides
      const mergedEnv: NodeJS.ProcessEnv = { ...env, ...rest.env }
      if (withoutBinDir && rest.env?.["CODEX_LOCAL_BIN_DIR"] === undefined) delete mergedEnv["CODEX_LOCAL_BIN_DIR"]
      const merged: CodexSandboxOptions = withoutBinDir
        ? { codexHome, projectDirectory, ...rest, env: mergedEnv }
        : { codexHome, binDir, projectDirectory, ...rest, env: mergedEnv }
      assertInsideSandbox(root, merged, withoutBinDir)
      return merged
    },
    // A complete environment for a spawned installer: the platform essentials plus the sandbox paths, nothing else
    // inherited.
    spawnEnv(overrides = {}) {
      const essentials: Record<string, string> = {}
      for (const key of SPAWN_ESSENTIALS) {
        const value = process.env[key]
        if (value !== undefined) essentials[key] = value
      }
      const merged: Record<string, string> = { ...essentials, TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...env }
      for (const [key, value] of Object.entries(overrides)) if (value !== undefined) merged[key] = value
      assertSandboxEnv(root, merged)
      return merged
    },
    dispose() {
      rmSync(root, { recursive: true, force: true })
      liveSandboxRoots.delete(root)
    },
  }
}
