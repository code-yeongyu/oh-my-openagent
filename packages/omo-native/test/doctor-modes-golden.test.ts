// Parity pins for `omo doctor --fix [--dry-run]` and `omo doctor --models [--json]` (#14959): the
// printed bytes and the exit code, written before the diagnostics move and kept unmodified through it.
// The models runtime and engine are fakes, so the pin is the rendering and the exit code, not a chain.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { capture, createInstall, importInstalled, type Install } from "./doctor-golden.test-support"

type FixResult = { lines: string[]; failed: boolean }
type ReflectionLockModule = { reflectionLockFix(options: Record<string, unknown>): Promise<FixResult> }
type ModelChainsModule = { runDoctorModels(args: string[], options: Record<string, unknown>): Promise<number> }

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const HOST = "this-host"
const NOW = Date.parse("2026-11-05T06:00:00.000Z")
const PROBE = { getPidLiveness: () => "dead", hostname: () => HOST, now: () => NOW }

function write(path: string, content: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content))
}

function interruptedLaunch(install: Install, id: string): string {
  const reflectionDir = join(install.memory, "agents", id, "runtime", "reflection")
  mkdirSync(join(install.memory, "agents", id, "repo"), { recursive: true })
  write(join(reflectionDir, "active.lock"), {
    runId: "reflection-run-64",
    request: { trigger: "manual", conversationIds: [], snapshots: [] },
    reservedAt: new Date(NOW - 10 * 60_000).toISOString(),
    launcherPid: 11096,
    launcherHostname: HOST,
    launcherProcessStart: null,
  })
  return reflectionDir
}

// What the launcher does with the result: print the lines, exit 1 when any step failed.
async function fix(install: Install, dryRun: boolean) {
  const { reflectionLockFix } = await importInstalled<ReflectionLockModule>(
    install,
    "bin/lib/doctor-reflection-lock.js",
  )
  return capture(install.root, async () => {
    const result = await reflectionLockFix({
      dryRun,
      env: { OMO_MEMORY_HOME: install.memory },
      home: install.home,
      reflectionLockProbe: PROBE,
    })
    console.log(result.lines.join("\n"))
    process.exitCode = result.failed ? 1 : 0
  })
}

describe("omo doctor --fix golden", () => {
  test("#given no memory #when --fix and --fix --dry-run run #then each prints its one nothing-to-do line with exit code 0", async () => {
    const install = createInstall(roots)
    expect([await fix(install, true), await fix(install, false)]).toEqual([
      { stdout: "INFO nothing to fix", stderr: "", exitCode: 0 },
      { stdout: "PASS no stale reflection locks", stderr: "", exitCode: 0 },
    ])
  })

  test("#given an interrupted launch and an unreadable ledger #when --fix --dry-run then --fix run #then the decisions and the fixes render exactly as today", async () => {
    const install = createInstall(roots)
    interruptedLaunch(install, "agent-a")
    write(join(interruptedLaunch(install, "agent-c"), "runs", "reflection-run-64", "ledger.json"), "{ torn")
    expect([await fix(install, true), await fix(install, false)]).toEqual([
      {
        stdout: [
          "WOULD FIX agent-a active.lock run reflection-run-64 (launch-interrupted)",
          "WOULD FIX agent-c active.lock run reflection-run-64 (ledger-unreadable)",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      },
      {
        stdout: [
          "FIXED agent-a active.lock run reflection-run-64 (launch-interrupted)",
          "FIXED agent-c active.lock run reflection-run-64 (ledger-unreadable)",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      },
    ])
  })
})

const VIEW = {
  excludeModels: ["claude-fable-*"],
  configProfile: "work",
  categories: [
    {
      name: "artistry",
      status: "resolved",
      runtime: ["anthropic/claude-opus-5-5", "openai/gpt-6.1"],
      rungs: [
        { model: "anthropic/claude-opus-5-5", source: "omo.json", state: "primary" },
        { model: "anthropic/claude-fable-5-2", source: "built-in", state: "excluded", excludedBy: "claude-fable-*" },
        { model: "openai/gpt-6.1", providers: ["openai", "azure"], source: "built-in", state: "fallback" },
        { model: "google/gemini-4", source: "built-in", state: "no-login" },
      ],
    },
    { name: "quick", status: "unresolved", reason: "no login for any rung", rungs: [] },
  ],
  agents: [
    {
      name: "explore",
      status: "resolved",
      runtime: ["openai/gpt-6.1"],
      rungs: [
        { model: "openai/gpt-6.1", source: "quick", state: "fallback" },
        { model: "xai/grok-5", source: "built-in", state: "not-reached" },
      ],
    },
  ],
  modelProfile: {
    selection: "unset",
    profile: "default",
    reason: "no rung has a login",
    rungs: [{ model: "anthropic/claude-opus-5-5", source: "built-in", state: "applied" }],
  },
}

const ENGINE = {
  ReadOnlyAuthStorage: class {},
  InMemoryCodingAgentModelsStore: class {},
  SettingsManager: { create: () => ({}) },
  loadAnthropicSubscriptionSettings: () => ({}),
  registerAnthropicSubscription: () => {},
  ModelRuntime: {
    create: async () => ({
      registerProvider: async () => {},
      getAvailable: async () => [{ provider: "anthropic", id: "claude-opus-5-5" }],
    }),
  },
}

async function models(install: Install, args: string[], loadRuntime: () => Promise<unknown>) {
  const { runDoctorModels } = await importInstalled<ModelChainsModule>(install, "bin/lib/model-chains.js")
  return capture(install.root, async () => {
    process.exitCode = await runDoctorModels(args, {
      agentDir: install.agentDir,
      cwd: install.home,
      env: { HOME: install.home },
      loadEngine: async () => ENGINE,
      loadRuntime,
    })
  })
}

describe("omo doctor --models golden", () => {
  const runtime = async () => ({ modelChains: () => VIEW })

  test("#given a resolved view #when --models runs #then the human report renders exactly as today", async () => {
    expect(await models(createInstall(roots), [], runtime)).toEqual({
      stdout: [
        "Models a spawn resolves right now (logins read offline; credentials are not probed).",
        "exclude_models: claude-fable-*",
        "config profile: work",
        "",
        "categories",
        "  artistry: anthropic/claude-opus-5-5 -> openai/gpt-6.1",
        "    1. anthropic/claude-opus-5-5        omo.json   runs first",
        '    2. anthropic/claude-fable-5-2       built-in   excluded by exclude_models "claude-fable-*"',
        "    3. openai/gpt-6.1 (openai | azure)  built-in   fallback 1",
        "    4. google/gemini-4                  built-in   no login",
        "  quick: unresolved (no login for any rung)",
        "",
        "agents",
        "  explore: openai/gpt-6.1",
        "    1. openai/gpt-6.1  quick      fallback 1",
        "    2. xai/grok-5      built-in   not reached",
        "",
        "main session (model_profile unset, default lane default)",
        "  none (no rung has a login)",
        "    1. anthropic/claude-opus-5-5  built-in   applied",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    })
  })

  test("#given a resolved view #when --models --json runs #then the view is printed as two-space JSON", async () => {
    expect(await models(createInstall(roots), ["--json"], runtime)).toEqual({
      stdout: JSON.stringify(VIEW, null, 2),
      stderr: "",
      exitCode: 0,
    })
  })

  test("#given a runtime that cannot load #when --models runs #then one FAIL line and exit code 1", async () => {
    const broken = async () => {
      throw new Error("runtime bundle missing (fixture)")
    }
    expect(await models(createInstall(roots), [], broken)).toEqual({
      stdout: "FAIL models: runtime bundle missing (fixture)",
      stderr: "",
      exitCode: 1,
    })
  })

  test("#given an unknown option #when --models runs #then the usage goes to stderr with exit code 2", async () => {
    expect(await models(createInstall(roots), ["--json", "--all", "-x"], runtime)).toEqual({
      stdout: "",
      stderr: "omo doctor --models: unknown option --all -x (accepted: --json)",
      exitCode: 2,
    })
  })
})
