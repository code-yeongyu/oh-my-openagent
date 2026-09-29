import { describe, expect, test } from "bun:test"

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
  const sdk = Object.fromEntries(["list", "read", "send", "bind", "unbind", "rebind", "bindings", "report", "outbox", "ack", "answer"].map((name) => [name, method(name)]))
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

  test("#given unbind, rebind, report and answer #when run #then each maps its positionals and flags", async () => {
    const printed = [
      JSON.parse((await run(["unbind", "b-1", "--revision", "2", "--json"])).stdout),
      JSON.parse((await run(["rebind", "b-1", "other", "--revision", "2", "--json"])).stdout),
      JSON.parse((await run(["report", "my-tui", "question", "proceed?", "--binding", "b-1", "--request-id", "ui-1", "--json"])).stdout),
      JSON.parse((await run(["answer", "--binding", "b-1", "--token", "rt1.x.y", "yes", "--json"])).stdout),
    ]
    expect(printed.map(({ method, request }) => ({ method, request }))).toEqual([
      { method: "unbind", request: { binding_id: "b-1", expected_revision: 2 } },
      { method: "rebind", request: { binding_id: "b-1", session: "other", expected_revision: 2 } },
      { method: "report", request: { session: "my-tui", kind: "question", text: "proceed?", binding_id: "b-1", request_id: "ui-1" } },
      { method: "answer", request: { binding_id: "b-1", reply_token: "rt1.x.y", answer: "yes" } },
    ])
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
    [["send", "--binding", "b-1", "--mode", "steer", "hi"], "--binding delivers with the binding's inbound mode"],
    [["send", "only-target"], "needs <target> <text>"],
    [["unbind", "b-1", "--revision", "x"], "--revision must be a non-negative integer"],
    [["list", "--bogus"], "unknown option '--bogus'"],
    [["nope"], "unknown subcommand 'nope'"],
    [["send", "my-tui", "ping", "--mode", "bogus"], "--mode must be one of auto, steer, follow_up"],
    [["bind", "my-tui", "--platform", "p", "--account", "a", "--chat", "c", "--direction", "sideways"], "--direction must be one of in, out, both"],
    [["bind", "my-tui", "--platform", "p", "--account", "a", "--chat", "c", "--direction", "inbound"], "--direction must be one of in, out, both"],
    [["send", "my-tui", "   "], "<text> is empty"],
    [["send", "--binding", "b-1", ""], "<text> is empty"],
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
    })
    expect(loaded.error).toBeUndefined()
    expect({ agentDir: received.agentDir, cwd: received.cwd, uid: received.uid, user: received.user }).toEqual({ agentDir: "/agent", cwd: "/work", uid: 501, user: "qa" })
    const statusAll = received.engineStatusAll as () => Promise<string>
    expect(await statusAll()).toBe("{\"endpoints\":[]}")
    expect(engineCalls).toEqual([{ args: ["host", "status", "--json", "--all", "--include-workers"], env: { KEEP: "1", OMO_AGENT_DIR: "/agent" } }])
  })
})
