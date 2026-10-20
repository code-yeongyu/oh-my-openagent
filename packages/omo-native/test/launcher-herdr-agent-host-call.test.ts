import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type Spawned = { argv: string[]; HERDR_AGENT: string | null; marker: string | null }

/** Runs a real omo command over a fake engine that records the environment of every launch. */
function engineLaunches(args: readonly string[], env: Record<string, string>): Spawned[] {
  const root = mkdtempSync(join(tmpdir(), "omo-herdr-host-call-"))
  roots.push(root)
  const app = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  write(join(app, "package.json"), JSON.stringify({
    name: "omo-ai", version: "1.2.3-test.0", type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpi = join(app, "node_modules", "@code-yeongyu", "senpi")
  write(join(senpi, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" },
  }))
  write(join(senpi, "dist", "index.js"), "export const fixture = true\n")
  write(join(senpi, "dist", "cli.js"), `import { appendFileSync } from "node:fs"
appendFileSync(process.env.CLI_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), HERDR_AGENT: process.env.HERDR_AGENT ?? null, marker: process.env.OMO_HERDR_AGENT_HINT ?? null }) + "\\n")
console.log("{}")
`)
  write(join(senpi, "dist", "core", "brand.js"), "export {}\n")
  for (const artifact of [
    "plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js",
    "plugin/runtime/agent-toolkit/cli.js",
  ]) write(join(app, artifact), "fixture\n")
  const capture = join(root, "engine-launches.jsonl")
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  const { HERDR_ENV: _env, HERDR_AGENT: _agent, OMO_HERDR_AGENT_HINT: _marker, ...inherited } = process.env
  const result = spawnSync(process.execPath, [join(app, "bin", "omo.js"), ...args], {
    encoding: "utf8",
    env: {
      ...inherited, HOME: home, XDG_DATA_HOME: join(root, "xdg"), CLI_CAPTURE: capture,
      OMO_CODING_AGENT_DIR: join(root, "agent"), SENPI_CODING_AGENT_DIR: join(root, "agent"), ...env,
    },
  })
  if (!existsSync(capture)) throw new Error(`no engine was started (${result.status}): ${result.stderr}`)
  return readFileSync(capture, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Spawned)
}

// A host call merges its caller's environment into the engine's (engineHostCall), and the daemon
// and host-status callers pass the whole parent environment. An inherited OMO_HERDR_AGENT_HINT must
// not survive that merge: the task host and its RPC workers load the plugin, which would take a
// marker that matches a user-set HERDR_AGENT as the launcher's and remove the user's value (#10448).
describe("host calls never hand down an inherited herdr hint marker (#10448)", () => {
  const keepsUserValueWithoutMarker = (args: readonly string[]): void => {
    const launches = engineLaunches(args, { HERDR_ENV: "1", HERDR_AGENT: "claude", OMO_HERDR_AGENT_HINT: "claude" })
    expect(launches.length).toBeGreaterThan(0)
    for (const launch of launches) expect({ HERDR_AGENT: launch.HERDR_AGENT, marker: launch.marker }).toEqual({ HERDR_AGENT: "claude", marker: null })
  }

  // `omo daemon` refuses to start a task host on win32 by design (no unix socket, bin/lib/daemon.js),
  // so no engine is ever launched there and this case only applies on POSIX (#10523).
  test.skipIf(process.platform === "win32")("#given a user-set HERDR_AGENT and a matching inherited marker #when `omo daemon status` starts the engine #then it keeps the user's value and gets no marker", () => {
    keepsUserValueWithoutMarker(["daemon", "status"])
  })

  test("#given a user-set HERDR_AGENT and a matching inherited marker #when `omo host status --all` starts the engine #then it keeps the user's value and gets no marker", () => {
    keepsUserValueWithoutMarker(["host", "status", "--all"])
  })
})
