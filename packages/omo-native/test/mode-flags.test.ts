import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { CACHE_FILENAME, CACHE_VERSION, setupDetectInputStats } from "../bin/lib/setup-detect-cache.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const SENTINEL = ".sandbox-token"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

interface Launch {
  argv: string[]
  env: NodeJS.ProcessEnv
  stdout: string
  stderr: string
  agentDir: string
  pluginRoot: string
  token: string
}

/**
 * A copied launcher over a fake engine, run from a full terminal (stdin, stdout and stderr all TTYs) inside herdr,
 * with a fresh setup-suggestion cache that reports sibling credentials. execve is replaced so the engine argv and
 * environment are recorded instead of replacing the probe.
 */
function launch(args: readonly string[]): Launch {
  const root = mkdtempSync(join(tmpdir(), "omo-mode-flags-"))
  roots.push(root)
  const packageRoot = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  write(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai", version: "1.2.3-test.0", type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  write(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" },
  }))
  write(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  write(join(senpiRoot, "dist", "cli.js"), "process.exit(0)\n")
  write(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  for (const artifact of [
    "plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js",
    "plugin/runtime/agent-toolkit/cli.js",
  ]) write(join(packageRoot, artifact), "fixture\n")
  // A per-launch token inside the sandbox's own extension payload. The handed extension directory is proved by
  // identity, never by spelling: the runtime resolves the copied launcher's module path, so macOS expands /var to
  // /private/var and Windows reports the runner profile in its long form where the temp dir keeps the 8.3 short
  // one, while the sandbox root keeps whatever spelling mkdtemp returned (#12458).
  const token = randomUUID()
  write(join(packageRoot, "plugin", SENTINEL), token)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  const agentDir = join(root, "agent")
  const capture = join(root, "exec.json")
  const probe = join(packageRoot, "probe.mjs")
  write(probe, `import { writeFileSync } from "node:fs"
import { runLauncher } from "./bin/lib/launcher.js"
Object.defineProperty(process, "platform", { value: "linux" })
for (const stream of [process.stdin, process.stdout, process.stderr]) Object.defineProperty(stream, "isTTY", { value: true })
process.execve = (file, argv, handed) => { writeFileSync(process.env.EXEC_CAPTURE, JSON.stringify({ argv, env: handed })) }
await runLauncher(${JSON.stringify(args)})
`)
  const { HERDR_AGENT: _agent, OMO_HERDR_AGENT_HINT: _marker, OMO_CODING_AGENT_DIR: _omoDir, PI_CODING_AGENT_DIR: _piDir, ...inherited } = process.env
  const env: NodeJS.ProcessEnv = {
    ...inherited, HOME: home, SENPI_CODING_AGENT_DIR: agentDir, XDG_DATA_HOME: join(root, "xdg"),
    EXEC_CAPTURE: capture, HERDR_ENV: "1",
  }
  // A fresh cache answers the sibling-credential hint without spawning a detached refresh child (#10398).
  write(join(agentDir, CACHE_FILENAME), `${JSON.stringify({
    version: CACHE_VERSION, writtenAt: Date.now(), inputs: setupDetectInputStats(env, home), suggestion: true,
  })}\n`)
  const result = spawnSync(process.execPath, [probe], { encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`launcher probe failed (${result.status}): ${result.stderr}`)
  const handed = JSON.parse(readFileSync(capture, "utf8"))
  return { ...handed, stdout: result.stdout, stderr: result.stderr, agentDir, pluginRoot: join(packageRoot, "plugin"), token }
}

const BANNER = "omo (omo-ai"
const SIBLING_HINT = "sibling credentials detected"

/** The engine must get the sandbox package's own extension directory; its spelling is not comparable across platforms. */
function expectExtension(run: Launch, tail: readonly string[]): void {
  expect(run.argv[2]).toBe("--extension")
  const handed = run.argv[3] ?? ""
  expect(run.argv.slice(4)).toEqual([...tail])
  expect(basename(handed)).toBe("plugin")
  expect(readFileSync(join(handed, SENTINEL), "utf8")).toBe(run.token)
  expect(readdirSync(handed).sort()).toEqual(readdirSync(run.pluginRoot).sort())
}

describe("omo --hand and --headless (#12414)", () => {
  test.each([["--hand"], ["--headless"]])("#given %s from a terminal inside herdr #then the engine gets omo's extension and agent dir, with no banner, setup hint, stdout output or herdr agent", (flag) => {
    const run = launch([flag])
    expectExtension(run, [flag])
    expect(run.env.SENPI_CODING_AGENT_DIR).toBe(run.agentDir)
    expect(run.stdout).toBe("")
    expect(run.stderr).not.toContain(BANNER)
    expect(run.stderr).not.toContain(SIBLING_HINT)
    expect(run.env.HERDR_AGENT).toBeUndefined()
    expect(run.env.OMO_HERDR_AGENT_HINT).toBeUndefined()
  })

  test("#given --hand after the -- separator #then it is prompt text and the launch stays interactive", () => {
    const run = launch(["--", "--hand"])
    expectExtension(run, ["--", "--hand"])
    expect(run.stderr).toContain(BANNER)
    expect(run.env.HERDR_AGENT).toBe("pi")
  })

  test.each([
    { args: ["hello"], banner: true, hint: "pi" },
    { args: ["-p", "hello"], banner: false, hint: undefined },
    { args: ["--mode", "rpc"], hint: undefined },
    { args: ["--mode", "json", "hello"], hint: undefined },
  ])("#given the existing mode $args #then its engine argv, banner and herdr hint are unchanged", ({ args, banner, hint }) => {
    const run = launch(args)
    expectExtension(run, args)
    expect(run.env.HERDR_AGENT).toBe(hint)
    if (banner === undefined) return
    expect(run.stderr.includes(BANNER)).toBe(banner)
    expect(run.stderr.includes(SIBLING_HINT)).toBe(banner)
  })
})
