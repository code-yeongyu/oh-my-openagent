import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

/** A copied launcher over a fake engine, with execve replaced so the handed environment is recorded. */
function launchCapture(args: readonly string[], env: Record<string, string>, stdinIsTTY = true): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), "omo-herdr-agent-"))
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
  const capture = join(root, "exec.json")
  const probe = join(packageRoot, "probe.mjs")
  write(probe, `import { writeFileSync } from "node:fs"
import { runLauncher } from "./bin/lib/launcher.js"
Object.defineProperty(process, "platform", { value: "linux" })
${stdinIsTTY ? 'Object.defineProperty(process.stdin, "isTTY", { value: true })\n' : ""}process.execve = (file, argv, handed) => { writeFileSync(process.env.EXEC_CAPTURE, JSON.stringify(handed)) }
await runLauncher(${JSON.stringify(args)})
`)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  const { HERDR_ENV: _env, HERDR_AGENT: _agent, OMO_HERDR_AGENT_HINT: _marker, ...inherited } = process.env
  const result = spawnSync(process.execPath, [probe], {
    encoding: "utf8",
    env: { ...inherited, HOME: home, SENPI_CODING_AGENT_DIR: join(root, "agent"), XDG_DATA_HOME: join(root, "xdg"), EXEC_CAPTURE: capture, ...env },
  })
  if (result.status !== 0) throw new Error(`launcher probe failed (${result.status}): ${result.stderr}`)
  return JSON.parse(readFileSync(capture, "utf8"))
}

describe("the launcher names the engine for herdr (#10448)", () => {
  test("#given an interactive launch inside herdr #then the engine starts with HERDR_AGENT=pi and the launcher's marker", () => {
    const handed = launchCapture(["hello"], { HERDR_ENV: "1" })
    expect(handed.HERDR_AGENT).toBe("pi")
    expect(handed.OMO_HERDR_AGENT_HINT).toBe("pi")
  })

  test("#given a user-set HERDR_AGENT and an inherited marker matching it #then the engine gets the user's value and no marker", () => {
    const handed = launchCapture(["hello"], { HERDR_ENV: "1", HERDR_AGENT: "claude", OMO_HERDR_AGENT_HINT: "claude" })
    expect(handed.HERDR_AGENT).toBe("claude")
    expect(handed.OMO_HERDR_AGENT_HINT).toBeUndefined()
  })

  test("#given an inherited marker on an engine command #then it is not handed down", () => {
    expect(launchCapture(["install"], { OMO_HERDR_AGENT_HINT: "pi" }).OMO_HERDR_AGENT_HINT).toBeUndefined()
  })

  test("#given piped stdin inside herdr #then no hint is handed down", () => {
    expect(launchCapture(["hello"], { HERDR_ENV: "1" }, false).HERDR_AGENT).toBeUndefined()
  })

  test("#given an interactive launch outside herdr #then no hint is handed down", () => {
    expect(launchCapture(["hello"], {}).HERDR_AGENT).toBeUndefined()
  })

  test("#given a print run inside herdr #then no hint is handed down", () => {
    expect(launchCapture(["-p", "hello"], { HERDR_ENV: "1" }).HERDR_AGENT).toBeUndefined()
  })
})
