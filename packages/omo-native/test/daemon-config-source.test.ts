import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { daemonReportLines, runDaemonCommand } from "../bin/lib/daemon.js"
import * as taskConfigRuntime from "../task-config-entry"

interface Workspace {
  readonly home: string
  readonly project: string
  readonly agentDir: string
  readonly pluginRoot: string
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "omo-daemon-config-source-"))
  const home = join(root, "home")
  const project = join(home, "work", "project")
  const agentDir = join(home, ".omo", "agent")
  const pluginRoot = join(root, "plugin")
  for (const dir of [project, agentDir, pluginRoot]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(pluginRoot, "daemon-launch-spec.json"), JSON.stringify({ schemaVersion: 1, argv: ["--mode", "rpc"], env: {} }))
  return { home, project, agentDir, pluginRoot }
}

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function fakeEngine() {
  const calls: string[][] = []
  const envs: Record<string, string | undefined>[] = []
  return {
    calls,
    envs,
    run(args: string[], options?: { env?: Record<string, string | undefined> }) {
      calls.push(args)
      envs.push(options?.env ?? {})
      return { exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 7 }), stderr: "" }
    },
  }
}

const sink = { write: () => true }

type RunOptions = { args?: string[]; cwd?: string; loadTaskConfig?: () => unknown }

function runEngine(ws: Workspace, options: RunOptions = {}): ReturnType<typeof fakeEngine> {
  const engine = fakeEngine()
  runDaemonCommand(["run", ...(options.args ?? [])], {
    engine,
    pluginRoot: ws.pluginRoot,
    agentDir: ws.agentDir,
    env: { HOME: ws.home },
    cwd: options.cwd ?? ws.home,
    loadTaskConfig: options.loadTaskConfig ?? (() => taskConfigRuntime),
    stdout: sink,
    stderr: sink,
    platform: "darwin",
  })
  return engine
}

function runPolicy(ws: Workspace, options: RunOptions = {}): string | undefined {
  const args = runEngine(ws, options).calls[0] ?? []
  return args[args.indexOf("--policy") + 1]
}

function runIdleExitMs(ws: Workspace, options: RunOptions = {}): string | undefined {
  return runEngine(ws, options).envs[0]?.SENPI_RPC_HOST_IDLE_EXIT_MS
}

function doctorLines(ws: Workspace, loadTaskConfig: () => unknown = () => taskConfigRuntime): string[] {
  return daemonReportLines({
    engine: fakeEngine(),
    pluginRoot: ws.pluginRoot,
    agentDir: ws.agentDir,
    env: { HOME: ws.home },
    cwd: ws.home,
    loadTaskConfig,
    platform: "darwin",
  })
}

const legacyWarn = (ws: Workspace, key: string, advice = "move it to ~/.omo/omo.jsonc") =>
  `WARN task.${key}: read from deprecated ${join(ws.agentDir, "omo.json")}; ${advice}`

const configWarns = (lines: string[]) => lines.filter((line) => line.startsWith("WARN task."))

describe("omo daemon task.host_engine_policy source (#9192)", () => {
  test("#given ~/.omo/omo.jsonc with a comment line #when run #then its policy wins over the deprecated agent-dir file", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), '// daemon policy\n{ "task": { "host_engine_policy": "fallback" } }\n')
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_engine_policy: "never" } }))

    expect(runPolicy(ws)).toBe("fallback")
    expect(doctorLines(ws)).not.toContain(legacyWarn(ws, "host_engine_policy"))
  })

  test("#given ~/.omo/omo.json only #when run #then its policy is applied", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.json"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))

    expect(runPolicy(ws)).toBe("fallback")
  })

  test("#given a project .omo layer and a user layer #when run from the project #then the project layer wins", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))
    write(join(ws.project, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_engine_policy: "upgrade" } }))

    expect(runPolicy(ws, { cwd: ws.project })).toBe("upgrade")
    expect(runPolicy(ws, { cwd: ws.home })).toBe("fallback")
  })

  test("#given only the deprecated agent-dir omo.json #when run and doctor #then its policy applies and doctor warns once", () => {
    const ws = workspace()
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))

    expect(runPolicy(ws)).toBe("fallback")
    expect(configWarns(doctorLines(ws))).toEqual([legacyWarn(ws, "host_engine_policy")])
  })

  test("#given a config layer that sets only another task key #when run and doctor #then the deprecated policy still applies and doctor warns once", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_idle_exit_ms: 60000 } }))
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))

    expect(runPolicy(ws)).toBe("fallback")
    expect(runIdleExitMs(ws)).toBe("60000")
    expect(configWarns(doctorLines(ws))).toEqual([legacyWarn(ws, "host_engine_policy")])
  })

  test("#given a deprecated agent-dir policy of never #when doctor #then it points to --no-upgrade, which the config key cannot express", () => {
    const ws = workspace()
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_engine_policy: "never" } }))

    expect(runPolicy(ws)).toBe("never")
    expect(configWarns(doctorLines(ws))).toEqual([
      legacyWarn(
        ws,
        "host_engine_policy",
        '"never" is a command-line policy only (the config key accepts upgrade|fallback); pass --no-upgrade instead',
      ),
    ])
  })

  test("#given a configured policy #when run --no-upgrade #then the flag wins", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))

    expect(runPolicy(ws, { args: ["--no-upgrade"] })).toBe("never")
  })

  test("#given the staged runtime is missing #when run and doctor #then the deprecated file is read as before and doctor adds nothing", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_engine_policy: "upgrade" } }))
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))
    const missing = () => {
      throw new Error("Cannot find module runtime/task-config/index.js")
    }

    expect(runPolicy(ws, { loadTaskConfig: missing })).toBe("fallback")
    expect(configWarns(doctorLines(ws, missing))).toEqual([])
  })
})

describe("omo daemon task.host_idle_exit_ms source (#9192)", () => {
  test("#given ~/.omo/omo.jsonc with a comment line #when run #then its idle exit wins over the deprecated agent-dir file", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), '// idle exit\n{ "task": { "host_idle_exit_ms": 60000 } }\n')
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_idle_exit_ms: 5000 } }))

    expect(runIdleExitMs(ws)).toBe("60000")
    expect(configWarns(doctorLines(ws))).toEqual([])
  })

  test("#given a project .omo layer and a user layer #when run from the project #then the project idle exit wins", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_idle_exit_ms: 60000 } }))
    write(join(ws.project, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_idle_exit_ms: 30000 } }))

    expect(runIdleExitMs(ws, { cwd: ws.project })).toBe("30000")
    expect(runIdleExitMs(ws, { cwd: ws.home })).toBe("60000")
  })

  test("#given only the deprecated agent-dir idle exit #when run and doctor #then it applies and doctor warns once", () => {
    const ws = workspace()
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_idle_exit_ms: 5000 } }))

    expect(runIdleExitMs(ws)).toBe("5000")
    expect(configWarns(doctorLines(ws))).toEqual([legacyWarn(ws, "host_idle_exit_ms")])
  })

  test("#given a fractional deprecated idle exit #when doctor #then the advice keeps it valid for the config schema", () => {
    const ws = workspace()
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_idle_exit_ms: 1500.5 } }))

    expect(runIdleExitMs(ws)).toBe("1500")
    expect(configWarns(doctorLines(ws))).toEqual([
      legacyWarn(ws, "host_idle_exit_ms", "move it to ~/.omo/omo.jsonc as whole milliseconds"),
    ])
  })

  test("#given a policy in omo.jsonc and an idle exit only in the deprecated file #when run and doctor #then each key keeps its own source", () => {
    const ws = workspace()
    write(join(ws.home, ".omo", "omo.jsonc"), JSON.stringify({ task: { host_engine_policy: "fallback" } }))
    write(join(ws.agentDir, "omo.json"), JSON.stringify({ task: { host_engine_policy: "upgrade", host_idle_exit_ms: 5000 } }))

    const engine = runEngine(ws)
    const args = engine.calls[0] ?? []
    expect(args[args.indexOf("--policy") + 1]).toBe("fallback")
    expect(engine.envs[0]?.SENPI_RPC_HOST_IDLE_EXIT_MS).toBe("5000")
    expect(configWarns(doctorLines(ws))).toEqual([legacyWarn(ws, "host_idle_exit_ms")])
  })
})
