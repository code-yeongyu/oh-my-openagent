import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

/**
 * The JS launcher's `omo daemon adopt` end to end: the real `bin/omo.js` releases the session
 * through the plugin's thread SDK (a fake that answers the senpi `release_session` contract) and
 * then launches the engine on `--session <path>` with the plugin, in the session's own directory,
 * with the queued messages after `--`.
 */

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-launcher-adopt-")))
  roots.push(root)
  const packageRoot = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module", dependencies: { "@code-yeongyu/senpi": "2026.8.9" } }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" } }))
  writeFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  writeFile(join(senpiRoot, "dist", "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))
`)
  writeFile(join(packageRoot, "plugin", "runtime", "thread-sdk", "sdk.js"), `
export function createThreadSdk() {
  const thread = { thread_id: "dur-host", title: "host lane", cwd: process.env.ADOPT_CWD, status: "live", session_path: "/sessions/dur-host.jsonl", endpoint: { kind: "rpc_host", socket: "/agent/rpc/shards/i-0123456789abcdef.sock", routing_id: "rpc-1" }, surface: "desktop", alive: true }
  return {
    locate: async () => ({ kind: "ok", thread }),
    release: async () => ({ success: true, data: { released: true, session_path: thread.session_path, attachments: 0, dropped: { deliveries: [], user_messages: JSON.parse(process.env.ADOPT_DROPPED) } } }),
    dispose: async () => undefined,
  }
}
`)
  const sessionCwd = join(root, "session-cwd")
  mkdirSync(sessionCwd)
  return { root, packageRoot, sessionCwd, captureFile: join(root, "capture.json") }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo daemon adopt through the JS launcher", () => {
  test("#given a released session with queued messages #when adopted #then the engine starts with the plugin on --session, in the session's directory, the messages after --", () => {
    // given
    const fixture = createFixture()
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: "/usr/bin:/bin", HOME: fixture.root, CAPTURE_FILE: fixture.captureFile, ADOPT_CWD: fixture.sessionCwd, ADOPT_DROPPED: JSON.stringify(["first ask", "  ", "--no-extensions"]) }
    delete env.OMO_CODING_AGENT_DIR
    delete env.SENPI_CODING_AGENT_DIR
    delete env.PI_CODING_AGENT_DIR
    // when
    const result = spawnSync(process.execPath, [join(fixture.packageRoot, "bin", "omo.js"), "daemon", "adopt", "dur-host"], { cwd: fixture.root, encoding: "utf8", env })
    // then
    expect(result.status).toBe(0)
    const captured = JSON.parse(readFileSync(fixture.captureFile, "utf8")) as { argv: string[]; cwd: string }
    expect(captured.argv).toEqual(["--extension", join(fixture.packageRoot, "plugin"), "--session", "/sessions/dur-host.jsonl", "--", "first ask", "--no-extensions"])
    expect(realpathSync(captured.cwd)).toBe(fixture.sessionCwd)
  })
})
