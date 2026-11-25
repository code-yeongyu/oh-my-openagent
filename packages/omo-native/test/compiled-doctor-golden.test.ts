// Parity pins for `omo doctor` on the compiled binary (#14959): every mode through the compiled entry's
// dispatch, the printed bytes and the exit code, written before the diagnostics move and kept unmodified
// through it. The compiled binary has no `--fix`; today that argument prints the plain report.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runCompiledLauncher } from "../compile-entry"
import { asInstall, capture, createInstall, type Install } from "./doctor-golden.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const BINARY = "/home/u/.omo/binary-runtime/9.2.1/omo"
const PROCESSES = [
  { pid: 21, ppid: 1, elapsed: "04:00", tty: "pts/1", command: BINARY },
  { pid: 22, ppid: 50, elapsed: "05:00", tty: "pts/2", command: BINARY },
  { pid: 23, ppid: 1, elapsed: "06:00", tty: "?", command: `${BINARY} doctor` },
]

function release(install: Install, missing: readonly string[] = []): string {
  const execDir = join(install.root, "binary-runtime")
  mkdirSync(execDir, { recursive: true })
  writeFileSync(join(execDir, "package.json"), JSON.stringify({ version: "9.2.1" }))
  for (const artifact of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]) {
    if (missing.includes(artifact)) continue
    mkdirSync(join(execDir, artifact, ".."), { recursive: true })
    writeFileSync(join(execDir, artifact), "fixture\n")
  }
  return execDir
}

function quiet(install: Install): Record<string, unknown> {
  return {
    env: { PATH: install.emptyBin, HOME: install.home, OMO_MEMORY_HOME: install.memory },
    homeDir: install.home,
    computerUseLines: async () => [],
    coverageLines: async () => [],
    keychainHelperLines: () => [],
    trustLines: async () => [],
    memoryRuntimeLines: async () => [],
    list: () => [],
  }
}

function compiled(install: Install, execDir: string, args: string[], options: Record<string, unknown>) {
  return asInstall(install, () =>
    capture(install.root, () => runCompiledLauncher(["doctor", ...args], execDir, "2026.8.28", execDir, options)),
  )
}

const HEALTHY = {
  stdout: [
    "PASS plugin manifest: plugin/package.json",
    "PASS extension: plugin/extensions/omo.js",
    "PASS lsp-daemon runtime: plugin/runtime/lsp-daemon/dist/cli.js",
    "INFO omo 9.2.1 (engine: senpi 2026.8.28; scheme nodef)",
    "INFO Update: omo update",
    "INFO Daemon: not running",
    "INFO Hosts: engine too old to enumerate",
    "INFO config dir: <ROOT>/home/.omo/agent",
  ].join("\n"),
  stderr: "",
  exitCode: 0,
}

describe("compiled omo doctor golden", () => {
  test("#given a healthy release #when doctor runs #then the report and exit code are exactly today's", async () => {
    const install = createInstall(roots)
    expect(await compiled(install, release(install), [], quiet(install))).toEqual(HEALTHY)
  })

  test("#given --fix #when the compiled doctor runs #then it prints the plain report, as today", async () => {
    const install = createInstall(roots)
    expect(await compiled(install, release(install), ["--fix", "--dry-run"], quiet(install))).toEqual(HEALTHY)
  })

  test("#given a degraded release #when doctor runs #then every finding renders exactly as today and the exit code is 1", async () => {
    const install = createInstall(roots)
    const execDir = release(install, ["plugin/extensions/omo.js"])
    const result = await compiled(install, execDir, [], {
      ...quiet(install),
      list: () => PROCESSES,
      computerUseLines: async () => ["FAIL computer use engine: handshake-failed: fixture"],
      coverageLines: async () => ["WARN task categories: 0 of 10 usable with your connected providers"],
      keychainHelperLines: () => ["WARN keychain helper: fixture"],
      trustLines: async () => ["INFO engine trust: fixture"],
      memoryRuntimeLines: async () => {
        throw new Error("EACCES: fixture")
      },
    })
    expect(result).toEqual({
      stdout: [
        "PASS plugin manifest: plugin/package.json",
        "FAIL extension: missing plugin/extensions/omo.js",
        "PASS lsp-daemon runtime: plugin/runtime/lsp-daemon/dist/cli.js",
        "INFO omo 9.2.1 (engine: senpi 2026.8.28; scheme nodef)",
        "INFO Update: omo update",
        "WARN keychain helper: fixture",
        "INFO Daemon: not running",
        "INFO Hosts: engine too old to enumerate",
        "INFO config dir: <ROOT>/home/.omo/agent",
        "WARN stale engine pid 21 (age 04:00, tty pts/1) has no launcher; it was orphaned by a signaled launcher",
        "INFO reap them explicitly by pid: omo doctor --reap 21",
        "INFO engine trust: fixture",
        "FAIL computer use engine: handshake-failed: fixture",
        "WARN task categories: 0 of 10 usable with your connected providers",
        "WARN memory runtime: unavailable: EACCES: fixture",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    })
  })

  test("#given --reap with a refusal and a stale binary engine #when the compiled doctor runs #then only the stale engine is signalled and exit code 1", async () => {
    const install = createInstall(roots)
    const kills: [number, string][] = []
    const result = await compiled(install, release(install), ["--reap", "21", "22", "23", "x"], {
      list: () => PROCESSES,
      kill: (pid: number, signal: string) => kills.push([pid, signal]),
    })
    expect({ ...result, kills }).toEqual({
      stdout: [
        'FAIL refusing "x": --reap takes process ids',
        "PASS reaped stale engine pid 21 (age 04:00, tty pts/1)",
        "FAIL refusing pid 22: its launcher (pid 50) is alive, so it is a live session",
        "FAIL refusing pid 23: it is not an omo engine process",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
      kills: [[21, "SIGTERM"]],
    })
  })

  test("#given --models with a staged runtime, and with an unknown option #when the compiled doctor runs #then the report and the usage render exactly as today", async () => {
    const install = createInstall(roots)
    const execDir = release(install)
    const bundle = join(execDir, "plugin", "runtime", "category-coverage", "index.js")
    mkdirSync(join(bundle, ".."), { recursive: true })
    writeFileSync(
      bundle,
      `export const modelChains = ({ models }) => ({
  excludeModels: [],
  categories: [{ name: "quick", status: "resolved", runtime: ["fixture/" + models.length], rungs: [] }],
  agents: [],
  modelProfile: { selection: "set", profile: "fast", applied: "fixture/model", rungs: [] },
})\n`,
    )
    expect([
      await compiled(install, execDir, ["--models"], quiet(install)),
      await compiled(install, execDir, ["--models", "--yaml"], quiet(install)),
    ]).toEqual([
      {
        stdout: [
          "Models a spawn resolves right now (logins read offline; credentials are not probed).",
          "exclude_models: none",
          "",
          "categories",
          "  quick: fixture/0",
          "",
          "agents",
          "",
          "main session (model_profile fast)",
          "  fixture/model",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      },
      { stdout: "", stderr: "omo doctor --models: unknown option --yaml (accepted: --json)", exitCode: 2 },
    ])
  })
})
