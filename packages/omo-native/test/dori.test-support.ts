import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

export const DORI_DIR = join("node_modules", "dori-extension")
export const DORI_MANIFEST = {
  name: "dori-extension",
  type: "module",
  exports: { "./host": { import: "./host.js" } },
  doriExtension: { hostContract: 1 },
}

export const FIXTURE_HOST = [
  "export const HOST_CONTRACT_VERSION = 1",
  "export async function runGatewayCommand(args, context) {",
  "  const { agentDir, home, pluginRoot, threadSdkUrl, launch } = context",
  "  context.stdout.write(JSON.stringify({ args, agentDir, home, pluginRoot, threadSdkUrl, launch }) + '\\n')",
  "  return 7",
  "}",
  "export async function gatewayDoctorLines() { return [] }",
].join("\n")

export function removeDoriRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function tempRoot(prefix: string): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

export function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

export function home(userConfig?: string): { HOME: string } {
  const root = tempRoot("omo-dori-hook-home-")
  mkdirSync(join(root, ".omo"), { recursive: true })
  if (userConfig !== undefined) writeFileSync(join(root, ".omo", "omo.jsonc"), userConfig)
  return { HOME: root }
}

export function packagedOmo(doriHostSource?: string, manifest: Record<string, unknown> = DORI_MANIFEST): string {
  const app = tempRoot("omo-dori-hook-app-")
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  write(app, "package.json", JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module" }))
  write(app, "drive.mjs", [
    'import { runDoriCommand } from "./bin/lib/dori.js"',
    "process.exitCode = await runDoriCommand(process.argv.slice(2), { launch: ['omo-under-test', 'dori', 'connect'] })",
  ].join("\n"))
  if (doriHostSource !== undefined) {
    write(app, join(DORI_DIR, "package.json"), JSON.stringify(manifest))
    write(app, join(DORI_DIR, "host.js"), doriHostSource)
  }
  return app
}

export function drive(app: string, args: string[], env: { HOME: string }, runtime = process.execPath): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(runtime, [join(app, "drive.mjs"), ...args], {
    cwd: app,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: env.HOME, OMO_CODING_AGENT_DIR: join(env.HOME, ".omo", "agent") },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
