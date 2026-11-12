import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

export async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "omo-codex-install-"))
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writePlugin(root, name, version) {
  const pluginRoot = join(root, "plugins", name)
  await writePluginAt(pluginRoot, name, version)
}

export async function writePluginAt(pluginRoot, name, version) {
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(pluginRoot, "dist"), { recursive: true })
  await mkdir(join(pluginRoot, "hooks"), { recursive: true })
  await mkdir(join(pluginRoot, "skills", name), { recursive: true })
  await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), { recursive: true })
  await writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name,
    version,
    description: `${name} test plugin`,
    mcpServers: "./.mcp.json",
    hooks: "./hooks/hooks.json",
    skills: "./skills/",
  })
  await writeJson(join(pluginRoot, ".mcp.json"), {
    mcpServers: {
      [name]: {
        command: "node",
        args: ["./dist/cli.js", "mcp"],
        cwd: ".",
      },
    },
  })
  await writeJson(join(pluginRoot, "hooks", "hooks.json"), { hooks: {} })
  await writeFile(join(pluginRoot, "skills", name, "SKILL.md"), "---\nname: test\n---\n")
  await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"), 'name = "explorer"\n')
  await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "librarian.toml"), 'name = "librarian"\n')
  await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "plan.toml"), 'name = "plan"\n')
  await writeJson(join(pluginRoot, "package.json"), {
    name: `@example/${name}`,
    version,
    bin: {
      [name]: "./dist/cli.js",
    },
    scripts: {
      build: "node -e \"require('fs').writeFileSync('dist/cli.js', 'console.log(1)')\"",
    },
    dependencies: {},
  })
}

// One temp root per test that owns every path the Codex installer and cleanup can resolve (#13253). The installer
// falls back to the real home (CODEX_HOME, ~/.codex, ~/.local/bin, CODEX_LOCAL_BIN_DIR, OMO_CODEX_PROJECT, the working
// directory), so a test that leaves one of those to the environment can write or delete outside its scratch directory.
// options() and spawnEnv() refuse, before anything runs, a path that is missing or outside the root.
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
]
// What a spawned child needs from the parent to start at all; nothing a path is resolved from.
const SPAWN_ESSENTIALS = ["PATH", "SystemRoot", "SYSTEMROOT", "ComSpec", "PATHEXT", "windir", "LANG"]

function requireInside(root, what, value) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`codex install sandbox: ${what} is missing; the installer would fall back to a real path`)
  const path = resolve(value)
  if (path !== root && !path.startsWith(root + sep))
    throw new Error(`codex install sandbox: ${what} ${path} is outside ${root}`)
}

function assertSandboxEnv(root, env) {
  for (const key of SANDBOX_PATH_ENV) requireInside(root, `env.${key}`, env[key])
}

export function assertInsideCodexSandbox(root, options, { withoutBinDir = false } = {}) {
  requireInside(root, "options.codexHome", options.codexHome)
  requireInside(root, "options.projectDirectory", options.projectDirectory)
  if (options.env === undefined)
    throw new Error("codex install sandbox: options.env is missing; the installer would read process.env")
  for (const key of SANDBOX_PATH_ENV) {
    if (withoutBinDir && key === "CODEX_LOCAL_BIN_DIR" && options.env[key] === undefined) continue
    requireInside(root, `env.${key}`, options.env[key])
  }
  if (!withoutBinDir) requireInside(root, "options.binDir", options.binDir)
  // Without a bin dir option the installer takes CODEX_LOCAL_BIN_DIR, else a recorded or derived directory under
  // codexHome; both are checked above or live under the checked codexHome.
  else if (options.binDir !== undefined) throw new Error("codex install sandbox: withoutBinDir with a binDir option")
}

const liveSandboxRoots = new Set()

// Removes every sandbox root created so far; register it with afterEach so no test leaves its root behind.
export function disposeCodexInstallSandboxes() {
  for (const root of liveSandboxRoots) rmSync(root, { recursive: true, force: true })
  liveSandboxRoots.clear()
}

export function createCodexInstallSandbox(name = "sandbox") {
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
  const env = Object.freeze({
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
  const path = (...parts) => {
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
      const { withoutBinDir, ...rest } = overrides
      const merged = { codexHome, binDir, projectDirectory, ...rest, env: { ...env, ...rest.env } }
      if (withoutBinDir === true) {
        delete merged.binDir
        if (rest.env?.CODEX_LOCAL_BIN_DIR === undefined) delete merged.env.CODEX_LOCAL_BIN_DIR
      }
      assertInsideCodexSandbox(root, merged, { withoutBinDir: withoutBinDir === true })
      return merged
    },
    // A complete environment for a spawned installer: the platform essentials plus the sandbox paths, nothing else
    // inherited.
    spawnEnv(overrides = {}) {
      const essentials = Object.fromEntries(
        SPAWN_ESSENTIALS.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
      )
      const merged = { ...essentials, TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...env, ...overrides }
      assertSandboxEnv(root, merged)
      return merged
    },
    dispose() {
      rmSync(root, { recursive: true, force: true })
      liveSandboxRoots.delete(root)
    },
  }
}
