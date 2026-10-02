import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { engineHost, type EngineSession } from "../../omo-senpi/src/components/thread/gateway/testing/engine-session"
import { createThreadSdk } from "../../omo-senpi/src/components/thread/sdk"

import { loadThreadSdk, runThreadCommand, THREAD_EXIT } from "../bin/lib/thread.js"

/**
 * `omo thread` is a thin wrapper over the plugin's thread SDK: these tests pin which SDK call each
 * argv makes (the fake SDK answers with the request it got, so the assertion reads what the CLI
 * printed), the exit code of each outcome class, and the `--json` shapes a connector scripts against. The SDK's own behavior is covered in omo-senpi `sdk.test.ts`.
 */

type Call = { readonly method: string; readonly request: unknown }

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

function fakeSdk(answers: Record<string, unknown> = {}) {
  const calls: Call[] = []
  let disposed = 0
  const method = (name: string) => async (request: unknown) => {
    calls.push({ method: name, request })
    return answers[name] ?? { kind: "ok", method: name, request }
  }
  const sdk = Object.fromEntries(["list", "read", "send", "bind", "unbind", "rebind", "bindings", "report", "outbox", "ack", "answer", "create", "models", "setModel", "setReasoning"].map((name) => [name, method(name)]))
  return {
    calls,
    disposed: () => disposed,
    sdk: { ...sdk, principal: "cli:501", dispose: async () => void disposed++ },
  }
}

async function run(args: readonly string[], fake = fakeSdk(), extra: Record<string, unknown> = {}) {
  const stdout = capture()
  const stderr = capture()
  let loaded = 0
  const exitCode = await runThreadCommand([...args], {
    engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    pluginRoot: "/plugin",
    agentDir: "/agent",
    env: {},
    cwd: "/work",
    stdout,
    stderr,
    platform: "darwin",
    loadSqlite: async () => ({}),
    importSdk: async () => {
      loaded++
      return { createThreadSdk: () => fake.sdk }
    },
    identity: { uid: 501, user: "qa" },
    ...extra,
  })
  return { exitCode, stdout: stdout.text(), stderr: stderr.text(), calls: fake.calls, loaded, disposed: fake.disposed() }
}

describe("omo thread: argv to SDK calls", () => {
  test("#given list --json #when run #then the SDK lists in the workspace scope and stdout is the threads array", async () => {
    const fake = fakeSdk({ list: { kind: "ok", scope: "workspace", threads: [{ thread_id: "dur-tui", surface: "tui" }] } })
    const result = await run(["list", "--json"], fake)
    expect(result.calls.map((call) => call.method)).toEqual(["list"])
    expect(JSON.parse(result.stdout)).toEqual([{ thread_id: "dur-tui", surface: "tui" }])
    expect({ exitCode: result.exitCode, disposed: result.disposed }).toEqual({ exitCode: THREAD_EXIT.ok, disposed: 1 })
  })

  test("#given send with every addressing flag #when run #then the request carries exactly them, the turn as a number", async () => {
    const result = await run(["send", "my-tui", "ping", "--mode", "steer", "--expected-turn", "3", "--idempotency-key", "k-1", "--all-scope", "--json"])
    expect(JSON.parse(result.stdout)).toEqual({ kind: "ok", method: "send", request: { all_scope: true, thread: "my-tui", text: "ping", mode: "steer", expected_turn_id: 3, idempotency_key: "k-1" } })
  })

  test("#given send text that reads --json after -- #when run #then it is sent as text and the output stays human", async () => {
    const result = await run(["send", "my-tui", "--", "--json"])
    expect({ exitCode: result.exitCode, text: (result.calls[0]?.request as { text?: string }).text }).toEqual({ exitCode: THREAD_EXIT.ok, text: "--json" })
    expect(result.stdout.startsWith("sent: ")).toBe(true)
  })

  test("#given send --binding with only a text #when run #then it is the inbound path with no target and the key as the event id", async () => {
    const result = await run(["send", "--binding", "b-1", "--idempotency-key", "evt-9", "hello from outside", "--json"])
    expect(JSON.parse(result.stdout)).toEqual({ kind: "ok", method: "send", request: { text: "hello from outside", binding_id: "b-1", idempotency_key: "evt-9" } })
  })

  test("#given send --binding with an author and a per-message mode #when run #then the request carries the author record and the mode", async () => {
    const result = await run(["send", "--binding", "b-1", "--author-id", "U123", "--author-name", "Jane Doe", "--author-user-id", "u-jane", "--mode", "follow_up", "--idempotency-key", "evt-9", "hi", "--json"])
    expect(JSON.parse(result.stdout).request).toEqual({ text: "hi", binding_id: "b-1", idempotency_key: "evt-9", mode: "follow_up", author: { platform_user_id: "U123", display: "Jane Doe", user_id: "u-jane" } })
  })

  test("#given answer with an author #when run #then the answering human goes to the SDK", async () => {
    const result = await run(["answer", "--binding", "b-1", "--token", "rt1.x.y", "--author-id", "U123", "--author-name", "Jane", "yes", "--json"])
    expect(JSON.parse(result.stdout).request).toEqual({ binding_id: "b-1", reply_token: "rt1.x.y", answer: "yes", author: { platform_user_id: "U123", display: "Jane" } })
  })

  test("#given bind flags #when run #then direction, events and a ttl of none map to the binding record's fields", async () => {
    const result = await run(["bind", "my-tui", "--platform", "custom", "--account", "qa", "--chat", "c1", "--direction", "in", "--events", "milestone,report", "--ttl", "none", "--json"])
    expect(JSON.parse(result.stdout)).toEqual({ kind: "ok", method: "bind", request: { session: "my-tui", binding: { platform: "custom", account_id: "qa", chat_id: "c1", direction: { inbound: true, outbound: false }, outbound_events: ["milestone", "report"], ttl_seconds: null } } })
  })

  test.each([
    ["in", { inbound: true, outbound: false }],
    ["out", { inbound: false, outbound: true }],
    ["both", { inbound: true, outbound: true }],
  ])("#given --direction %s #when bound #then the binding carries exactly that direction", async (direction, expected) => {
    const result = await run(["bind", "my-tui", "--platform", "custom", "--account", "qa", "--chat", "c1", "--direction", direction, "--json"])
    expect(JSON.parse(result.stdout).request.binding.direction).toEqual(expected)
  })

  test("#given read --limit #when the transcript has more items #then only the newest ones are printed", async () => {
    const fake = fakeSdk({ read: { kind: "ok", thread_id: "t", items: [{ seq: 1, role: "user", content: "a" }, { seq: 2, role: "assistant", content: "b" }], truncated: false, source: "live_host" } })
    const result = await run(["read", "t", "--limit", "1", "--json"], fake)
    expect(JSON.parse(result.stdout).items).toEqual([{ seq: 2, role: "assistant", content: "b" }])
  })

  test("#given create --cwd --fork-from and models --all-scope #when run #then the SDK request carries them", async () => {
    const created = JSON.parse((await run(["create", "--cwd", "/repo", "--fork-from", "dur-1", "--json"])).stdout)
    const models = JSON.parse((await run(["models", "lane", "--all-scope", "--json"])).stdout)
    expect([created.request, models.request]).toEqual([{ cwd: "/repo", fork_from: "dur-1" }, { all_scope: true, thread: "lane" }])
  })

  test("#given unbind, rebind, report and answer #when run #then each maps its positionals and flags", async () => {
    const printed = [
      JSON.parse((await run(["unbind", "b-1", "--revision", "2", "--json"])).stdout),
      JSON.parse((await run(["rebind", "b-1", "other", "--revision", "2", "--json"])).stdout),
      JSON.parse((await run(["report", "my-tui", "question", "proceed?", "--binding", "b-1", "--request-id", "ui-1", "--request-kind", "confirm", "--json"])).stdout),
      JSON.parse((await run(["answer", "--binding", "b-1", "--token", "rt1.x.y", "yes", "--json"])).stdout),
    ]
    expect(printed.map(({ method, request }) => ({ method, request }))).toEqual([
      { method: "unbind", request: { binding_id: "b-1", expected_revision: 2 } },
      { method: "rebind", request: { binding_id: "b-1", session: "other", expected_revision: 2 } },
      { method: "report", request: { session: "my-tui", kind: "question", text: "proceed?", binding_id: "b-1", request_id: "ui-1", request_kind: "confirm" } },
      { method: "answer", request: { binding_id: "b-1", reply_token: "rt1.x.y", answer: "yes" } },
    ])
  })
})

/**
 * Model control end to end: the CLI over the real thread SDK, a real gateway store in a scratch agent
 * dir (each command opens and disposes its own, as `omo thread` does) and a host whose sessions run
 * the pinned engine's own model and thinking-level code (omo-senpi `gateway/testing/engine-session.ts`).
 * Assertions read the `--json` fields a connector consumes and the engine's own state.
 */
const MODELS = [
  { provider: "openai", id: "primary", levels: "xhigh" },
  { provider: "openai", id: "capped", levels: "high" },
  { provider: "openai", id: "candidate", levels: "xhigh" },
  { provider: "anthropic", id: "opus", levels: "high" },
] as const

function modelWorld() {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-thread-models-"))
  const sessions: EngineSession[] = []
  const host = engineHost(MODELS, sessions)
  const importSdk = async () => ({ createThreadSdk: (options: Record<string, unknown>) => createThreadSdk({ ...(options as Parameters<typeof createThreadSdk>[0]), agentDir, host, modelProfile: () => ({ model_profile: "recommended" }) }) })
  const cli = async (args: readonly string[]) => {
    const result = await run(args, fakeSdk(), { importSdk, cwd: process.cwd() })
    return { ...result, json: result.stdout.length > 0 && args.includes("--json") ? JSON.parse(result.stdout) : undefined }
  }
  return { cli, sessions, dispose: () => rmSync(agentDir, { recursive: true, force: true }) }
}

describe("omo thread: model control (#9425)", () => {
  test("#given connected models #when create runs with model flags, then with none #then the engine opens on exactly that model, auto otherwise, and models reports what the record says", async () => {
    const world = modelWorld()
    try {
      const set = await world.cli(["create", "--name", "lane", "--provider", "openai", "--model", "capped", "--thinking", "high", "--set-by", "config", "--json"])
      expect({ exitCode: set.exitCode, model: set.json.thread.model }).toEqual({ exitCode: THREAD_EXIT.ok, model: { provider: "openai", id: "capped", thinking_level: "high", provenance: "set", set_by: "config", reason: null } })
      expect({ model: world.sessions[0]?.session.model?.id, level: world.sessions[0]?.session.thinkingLevel }).toEqual({ model: "capped", level: "high" })
      const auto = await world.cli(["create", "--json"])
      expect(auto.json.thread.model).toMatchObject({ provenance: "auto", set_by: null })
      expect(world.sessions[1]?.session.model?.id).toBe(auto.json.thread.model.id)
      expect((await world.cli(["models", "lane", "--json"])).json.current).toEqual(set.json.thread.model)
      expect((await world.cli(["models", "--provider", "anthropic", "--json"])).json.available.map((entry: { id: string }) => entry.id)).toEqual(["opus"])
    } finally {
      world.dispose()
    }
  })

  test("#given a live thread #when set-model and set-reasoning run #then the engine switches and models reports the switch and who made it", async () => {
    const world = modelWorld()
    try {
      await world.cli(["create", "--name", "lane", "--model", "openai/primary", "--json"])
      const moved = await world.cli(["set-model", "lane", "opus", "--provider", "anthropic", "--set-by", "lead", "--json"])
      expect({ exitCode: moved.exitCode, model: moved.json.model }).toMatchObject({ exitCode: THREAD_EXIT.ok, model: { provider: "anthropic", id: "opus", provenance: "set", set_by: "lead" } })
      expect(world.sessions[0]?.session.model?.id).toBe("opus")
      const level = await world.cli(["set-reasoning", "lane", "low", "--scope", "turn", "--json"])
      expect(level.json).toMatchObject({ kind: "ok", level: "low", scope: "turn" })
      expect(world.sessions[0]?.session.thinkingLevel).toBe("low")
      expect((await world.cli(["models", "lane", "--json"])).json.current).toMatchObject({ provider: "anthropic", id: "opus", thinking_level: "low", set_by: "lead" })
    } finally {
      world.dispose()
    }
  })

  test("#given a refused set-model or set-reasoning #when run with --json #then the refusal is on stdout with its details, the exit code is refused, and neither the engine nor the record moves", async () => {
    const world = modelWorld()
    try {
      await world.cli(["create", "--name", "lane", "--model", "capped", "--json"])
      const before = (await world.cli(["models", "lane", "--json"])).json.current
      const ambiguous = await world.cli(["set-model", "lane", "ca", "--json"])
      expect({ exitCode: ambiguous.exitCode, error: ambiguous.json.error }).toMatchObject({ exitCode: THREAD_EXIT.refused, error: { code: "model_ambiguous", details: { candidates: ["openai/capped", "openai/candidate"] } } })
      const unsupported = await world.cli(["set-reasoning", "lane", "xhigh", "--json"])
      expect({ exitCode: unsupported.exitCode, error: unsupported.json.error }).toMatchObject({ exitCode: THREAD_EXIT.refused, error: { code: "thinking_level_unsupported", details: { supported: ["off", "minimal", "low", "medium", "high"] } } })
      expect({ model: world.sessions[0]?.session.model?.id, level: world.sessions[0]?.session.thinkingLevel }).toEqual({ model: "capped", level: before.thinking_level })
      expect((await world.cli(["models", "lane", "--json"])).json.current).toEqual(before)
    } finally {
      world.dispose()
    }
  })

  test("#given a created thread #when printed for a person #then the line names the thread, the model and who set it", async () => {
    const world = modelWorld()
    try {
      const created = await world.cli(["create", "--name", "lane", "--model", "capped", "--set-by", "config"])
      const durableId = world.sessions[0]?.durableId ?? "missing"
      expect(created.exitCode).toBe(THREAD_EXIT.ok)
      for (const token of [durableId, "openai/capped", "config"]) expect(created.stdout).toContain(token)
    } finally {
      world.dispose()
    }
  })
})

describe("omo thread: the connector outbox", () => {
  test("#given outbox --after --ack #when rows come back #then the read continues after that cursor and the ack goes through the newest row", async () => {
    const fake = fakeSdk({
      outbox: { kind: "ok", binding_id: "b-1", revision: 1, status: "active", rows: [{ cursor: 4 }, { cursor: 7 }], next_cursor: 7, acked_cursor: 3 },
      ack: { kind: "ok", binding_id: "b-1", acked_cursor: 7, changed: true },
    })
    const result = await run(["outbox", "b-1", "--after", "3", "--ack", "--json"], fake)
    expect(result.calls.map((call) => call.method)).toEqual(["outbox", "ack"])
    expect(result.calls[1]?.request).toEqual({ binding_id: "b-1", cursor: 7 })
    expect(JSON.parse(result.stdout)).toMatchObject({ rows: [{ cursor: 4 }, { cursor: 7 }], acked: { acked_cursor: 7, changed: true } })
  })

  test("#given an empty page #when outbox --ack runs #then nothing is acked", async () => {
    const fake = fakeSdk({ outbox: { kind: "ok", binding_id: "b-1", revision: 1, status: "active", rows: [], next_cursor: 7, acked_cursor: 7 } })
    const result = await run(["outbox", "b-1", "--ack", "--json"], fake)
    expect(result.calls.map((call) => call.method)).toEqual(["outbox"])
    expect(JSON.parse(result.stdout).acked).toBeNull()
  })

  test("#given ack with a provider message id #when run #then the cursor is a number", async () => {
    const result = await run(["ack", "b-1", "12", "--provider-message-id", "m-1", "--json"])
    expect(JSON.parse(result.stdout)).toEqual({ kind: "ok", method: "ack", request: { binding_id: "b-1", cursor: 12, provider_message_id: "m-1" } })
  })
})

describe("omo thread: exit codes", () => {
  test.each([
    ["binding_mismatch", THREAD_EXIT.refused],
    ["host_unavailable", THREAD_EXIT.unavailable],
    ["internal_error", THREAD_EXIT.failed],
  ])("#given the SDK answers %s #when run with --json #then the error is on stdout and the exit code classifies it", async (code, exitCode) => {
    const fake = fakeSdk({ answer: { kind: "error", error: { code, message: "m", next_action: "n" } } })
    const result = await run(["answer", "--binding", "Y", "--token", "rt1.x", "yes", "--json"], fake)
    expect(result.exitCode).toBe(exitCode)
    expect(JSON.parse(result.stdout)).toEqual({ kind: "error", error: { code, message: "m", next_action: "n" } })
    expect(result.stderr).toContain(code)
  })

  test.each([
    [["answer", "--token", "rt1.x", "yes"], "--binding is required"],
    [["send", "--binding", "b-1", "--mode", "steer", "hi"], "--binding takes --mode auto or follow_up"],
    [["send", "--binding", "b-1", "--expected-turn", "3", "hi"], "--binding takes no --expected-turn"],
    [["send", "my-tui", "ping", "--author-id", "U1", "--author-name", "Jane"], "--author-id/--author-name/--author-user-id need --binding"],
    [["send", "--binding", "b-1", "--author-id", "U1", "hi"], "--author-id and --author-name go together"],
    [["send", "--binding", "b-1", "--author-user-id", "u1", "hi"], "--author-id and --author-name go together"],
    [["answer", "--binding", "b-1", "--token", "rt", "--author-name", "Jane", "yes"], "--author-id and --author-name go together"],
    [["send", "only-target"], "needs <target> <text>"],
    [["unbind", "b-1", "--revision", "x"], "--revision must be a non-negative integer"],
    [["list", "--bogus"], "unknown option '--bogus'"],
    [["nope"], "unknown subcommand 'nope'"],
    [["send", "my-tui", "ping", "--mode", "bogus"], "--mode must be one of auto, steer, follow_up"],
    [["bind", "my-tui", "--platform", "p", "--account", "a", "--chat", "c", "--direction", "sideways"], "--direction must be one of in, out, both"],
    [["bind", "my-tui", "--platform", "p", "--account", "a", "--chat", "c", "--direction", "inbound"], "--direction must be one of in, out, both"],
    [["send", "my-tui", "   "], "<text> is empty"],
    [["send", "--binding", "b-1", ""], "<text> is empty"],
    [["create", "--model", "gpt-x", "--set-by", "robot"], "--set-by must be one of config, user, lead"],
    [["create", "--set-by", "config"], "--set-by needs --model"],
    [["create", "--thinking", "loud"], "--thinking must be one of off, minimal, low, medium, high, xhigh, max"],
    [["set-model", "lane", "gpt-x", "--set-by", "me"], "--set-by must be one of config, user, lead"],
    [["set-model", "lane", "  "], "<model> is empty"],
    [["set-model", "lane"], "expects 2 argument(s), got 1"],
    [["set-reasoning", "lane", "high", "--scope", "forever"], "--scope must be one of session, turn"],
    [["set-reasoning", "lane", "loud"], "<level> must be one of off, minimal, low, medium, high, xhigh, max"],
  ])("#given %p #when run #then it is a usage error and the SDK is never loaded", async (args, message) => {
    const result = await run(args)
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({ exitCode: THREAD_EXIT.usage, loaded: 0 })
    expect(result.stderr).toContain(message)
    expect(result.stdout).toBe("")
  })

  test.each([
    ["a usage error", ["send", "my-tui", "ping", "--mode", "bogus", "--json"], {}, THREAD_EXIT.usage, "invalid_arguments"],
    ["an unknown option", ["list", "--bogus", "--json"], {}, THREAD_EXIT.usage, "invalid_arguments"],
    ["win32", ["list", "--json"], { platform: "win32" }, THREAD_EXIT.unsupported, "unsupported"],
    ["no node:sqlite", ["list", "--json"], { loadSqlite: async () => { throw new Error("No such built-in module: node:sqlite") } }, THREAD_EXIT.unsupported, "unsupported"],
  ])("#given %s with --json #when run #then stdout is still one error JSON value", async (_label, args, extra, exitCode, code) => {
    const result = await run(args, fakeSdk(), extra)
    expect(result.exitCode).toBe(exitCode)
    const printed = JSON.parse(result.stdout)
    expect({ kind: printed.kind, code: printed.error.code }).toEqual({ kind: "error", code })
    expect(typeof printed.error.next_action).toBe("string")
  })

  test("#given win32 #when any subcommand runs #then it is refused as unsupported like omo daemon", async () => {
    const result = await run(["list"], fakeSdk(), { platform: "win32" })
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({ exitCode: THREAD_EXIT.unsupported, loaded: 0 })
    expect(result.stderr).toContain("win32")
  })

  test("#given a runtime without node:sqlite #when a subcommand runs #then it is a named refusal before the SDK loads", async () => {
    const result = await run(["list"], fakeSdk(), { loadSqlite: async () => { throw new Error("No such built-in module: node:sqlite") } })
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({ exitCode: THREAD_EXIT.unsupported, loaded: 0 })
    expect(result.stderr).toContain("node:sqlite is unavailable")
  })
})

describe("omo thread: SDK loading", () => {
  test("#given a plugin whose thread SDK cannot be imported #when a --json command runs #then stdout is one internal_error JSON value and the exit code is 5", async () => {
    const result = await run(["list", "--json"], fakeSdk(), { importSdk: async () => { throw new Error("Cannot find module sdk.js") } })
    expect(result.exitCode).toBe(THREAD_EXIT.failed)
    expect(JSON.parse(result.stdout)).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
  })

  test("#given an SDK whose dispose rejects #when a command succeeds #then its result and exit code stand and the failure is logged on stderr", async () => {
    const fake = fakeSdk({ list: { kind: "ok", scope: "workspace", threads: [] } })
    const failing = { ...fake, sdk: { ...fake.sdk, dispose: async () => { throw new Error("worker gone") } } }
    const result = await run(["list", "--json"], failing)
    expect({ exitCode: result.exitCode, stdout: JSON.parse(result.stdout) }).toEqual({ exitCode: THREAD_EXIT.ok, stdout: [] })
    expect(result.stderr).toContain("worker gone")
  })

  test("#given the staged task-config runtime #when the SDK resolves an auto model #then it reads omo.json's model_profile view for the cwd and env, and a broken runtime falls back to the default profile", async () => {
    const asked: unknown[] = []
    const profileOf = async (loadTaskConfig: (root: string) => unknown) => {
      let received: Record<string, unknown> = {}
      await loadThreadSdk({
        pluginRoot: "/plugin",
        agentDir: "/agent",
        env: { KEEP: "1" },
        cwd: "/work",
        engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
        loadSqlite: async () => ({}),
        importSdk: async () => ({ createThreadSdk: (options: Record<string, unknown>) => { received = options; return {} } }),
        identity: { uid: 501, user: "qa" },
        loadTaskConfig,
      })
      return (received.modelProfile as () => unknown)()
    }
    const view = { model_profile: "geeky-heavy", model_profiles: { mine: { models: ["openai/gpt-x"] } } }
    expect(await profileOf((root) => { asked.push(root); return { resolveThreadModelProfile: (input: unknown) => { asked.push(input); return view } } })).toEqual(view)
    expect(asked).toEqual(["/plugin", { cwd: "/work", env: { KEEP: "1" } }])
    expect(await profileOf(() => { throw new Error("Cannot find module index.js") })).toEqual({})
  })

  test("#given the plugin SDK #when loaded #then it gets the agent dir, cwd, cli identity, and an engine status reader over host status --all", async () => {
    const engineCalls: { args: readonly string[]; env: Record<string, string> }[] = []
    let received: Record<string, unknown> = {}
    const loaded = await loadThreadSdk({
      pluginRoot: "/plugin",
      agentDir: "/agent",
      env: { KEEP: "1" },
      cwd: "/work",
      engine: { run: (args: string[], options: { env: Record<string, string> }) => { engineCalls.push({ args, env: options.env }); return { exitCode: 0, stdout: "{\"endpoints\":[]}", stderr: "" } } },
      loadSqlite: async () => ({}),
      importSdk: async () => ({ createThreadSdk: (options: Record<string, unknown>) => { received = options; return {} } }),
      identity: { uid: 501, user: "qa" },
      loadTaskConfig: () => { throw new Error("Cannot find module index.js") },
    })
    expect(loaded.error).toBeUndefined()
    expect({ agentDir: received.agentDir, cwd: received.cwd, uid: received.uid, user: received.user }).toEqual({ agentDir: "/agent", cwd: "/work", uid: 501, user: "qa" })
    const statusAll = received.engineStatusAll as () => Promise<string>
    expect(await statusAll()).toBe("{\"endpoints\":[]}")
    expect(engineCalls).toEqual([{ args: ["host", "status", "--json", "--all", "--include-workers"], env: { KEEP: "1", OMO_AGENT_DIR: "/agent" } }])
  })
})
