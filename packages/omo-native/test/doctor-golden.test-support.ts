// Shared fixture for the `omo doctor` goldens: a packaged install copied into a temp root, so the
// launcher's package root, its pinned engine and its home are all ours, plus capture and path
// normalization that make one golden read the same on every platform.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
export const PINNED_ENGINE = "2026.8.9"
export const ARTIFACTS = ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]

export type Install = {
  readonly root: string
  readonly packageRoot: string
  readonly launcher: string
  readonly home: string
  readonly agentDir: string
  readonly memory: string
  readonly emptyBin: string
}

function writeFile(path: string, content = "fixture\n"): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function createInstall(
  roots: string[],
  options: { readonly engineVersion?: string; readonly missing?: readonly string[] } = {},
): Install {
  const root = mkdtempSync(join(tmpdir(), "omo-doctor-golden-"))
  roots.push(root)
  const packageRoot = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "omo-ai",
      version: "1.2.3-test.0",
      type: "module",
      dependencies: { "@code-yeongyu/senpi": PINNED_ENGINE },
    }),
  )
  const engine = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  writeFile(
    join(engine, "package.json"),
    JSON.stringify({
      name: "@code-yeongyu/senpi",
      version: options.engineVersion ?? PINNED_ENGINE,
      type: "module",
      exports: { ".": "./dist/index.js" },
    }),
  )
  writeFile(join(engine, "dist", "index.js"), "export const fixture = true\n")
  writeFile(join(engine, "dist", "cli.js"), "process.exit(0)\n")
  writeFile(join(engine, "dist", "core", "brand.js"), "export {}\n")
  for (const artifact of ARTIFACTS) {
    if (!options.missing?.includes(artifact)) writeFile(join(packageRoot, artifact))
  }
  const home = join(root, "home")
  const agentDir = join(home, ".omo", "agent")
  mkdirSync(agentDir, { recursive: true })
  const memory = join(root, "memory")
  const emptyBin = join(root, "empty-bin")
  mkdirSync(emptyBin, { recursive: true })
  return { root, packageRoot, launcher: join(packageRoot, "bin", "omo.js"), home, agentDir, memory, emptyBin }
}

/** A module of the copied launcher, so its package root is the fixture's. */
export function importInstalled<T>(install: Install, relative: string): Promise<T> {
  return import(pathToFileURL(join(install.packageRoot, relative)).href)
}

/** The fixture root becomes `<ROOT>` and every separator `/`, so one golden holds on every platform. */
export function normalize(text: string, root: string): string {
  return text.replaceAll(root, "<ROOT>").replaceAll(root.replaceAll("\\", "/"), "<ROOT>").replaceAll("\\", "/")
}

export type Captured = { readonly stdout: string; readonly stderr: string; readonly exitCode: number }

export async function capture(root: string, run: () => unknown): Promise<Captured> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = console.log
  const error = console.error
  const previousExitCode = process.exitCode
  process.exitCode = 0
  console.log = (value?: unknown) => stdout.push(String(value))
  console.error = (value?: unknown) => stderr.push(String(value))
  try {
    await run()
    return {
      stdout: normalize(stdout.join("\n"), root),
      stderr: normalize(stderr.join("\n"), root),
      exitCode: Number(process.exitCode ?? 0),
    }
  } finally {
    console.log = log
    console.error = error
    // Assigning undefined does not clear an exit code a run set, so the runner itself would exit 1.
    process.exitCode = previousExitCode ?? 0
  }
}

const PROCESS_VARIABLES = [
  "OMO_CODING_AGENT_DIR",
  "SENPI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
  "HOME",
  "USERPROFILE",
]

/**
 * Parts of doctor read the process itself (agent dir, home, cwd) instead of an injected option;
 * point all of them at the fixture for one call.
 */
export async function asInstall<T>(install: Install, run: () => Promise<T>): Promise<T> {
  const saved = PROCESS_VARIABLES.map((name) => [name, process.env[name]] as const)
  const cwd = process.cwd()
  for (const name of PROCESS_VARIABLES) delete process.env[name]
  process.env.OMO_CODING_AGENT_DIR = install.agentDir
  process.env.HOME = install.home
  process.env.USERPROFILE = install.home
  process.chdir(install.home)
  try {
    return await run()
  } finally {
    process.chdir(cwd)
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}
