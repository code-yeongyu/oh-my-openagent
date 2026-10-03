import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

export const GATEWAY_DIR = join("node_modules", "@oh-my-opencode", "omo-gateway")
export const GATEWAY_MANIFEST = {
  name: "@oh-my-opencode/omo-gateway",
  type: "module",
  exports: { "./host": { import: "./host.js" } },
  omoGateway: { hostContract: 1 },
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

export function removeGatewayRoots(): void {
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
  const root = tempRoot("omo-gateway-hook-home-")
  mkdirSync(join(root, ".omo"), { recursive: true })
  if (userConfig !== undefined) writeFileSync(join(root, ".omo", "omo.jsonc"), userConfig)
  return { HOME: root }
}

export function packagedOmo(gatewayHostSource?: string, manifest: Record<string, unknown> = GATEWAY_MANIFEST): string {
  const app = tempRoot("omo-gateway-hook-app-")
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  write(app, "package.json", JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module" }))
  write(app, "drive.mjs", [
    'import { runGatewayCommand } from "./bin/lib/gateway.js"',
    "process.exitCode = await runGatewayCommand(process.argv.slice(2), { launch: ['omo-under-test', 'gateway', 'connect'] })",
  ].join("\n"))
  if (gatewayHostSource !== undefined) {
    write(app, join(GATEWAY_DIR, "package.json"), JSON.stringify(manifest))
    write(app, join(GATEWAY_DIR, "host.js"), gatewayHostSource)
  }
  return app
}

export function drive(app: string, args: string[], env: { HOME: string }): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(app, "drive.mjs"), ...args], {
    cwd: app,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: env.HOME, OMO_CODING_AGENT_DIR: join(env.HOME, ".omo", "agent") },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
