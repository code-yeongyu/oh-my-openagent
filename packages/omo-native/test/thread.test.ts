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
  const sdk = Object.fromEntries(["list", "read", "send"].map((name) => [name, method(name)]))
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
  return {
    exitCode,
    stdout: stdout.text(),
    stderr: stderr.text(),
    calls: fake.calls,
    loaded,
    disposed: fake.disposed(),
  }
}

describe("omo thread: argv to SDK calls", () => {
  test("#given list --json #when run #then the SDK lists in the workspace scope and stdout is its whole result: threads, devices and remote_unavailable", async () => {
    const list = {
      kind: "ok",
      scope: "workspace",
      threads: [
        { thread: "dur-tui", surface: "tui", status: "live", name: "here", cwd: "/w" },
        { thread: "dur-on-b", status: "resumable", name: "on b", cwd: "/b", device: "dev-b" },
      ],
      devices: [
        {
          device: "dev-a",
          name: "this mac",
          platform: "darwin",
          online: true,
          last_seen: null,
          this_device: true,
          threads: 1,
          listing: "listed",
        },
        {
          device: "dev-b",
          name: "build box",
          platform: "linux",
          kind: "cli",
          online: true,
          last_seen: null,
          this_device: false,
          threads: 1,
          listing: "listed",
        },
        {
          device: "dev-c",
          name: "laptop",
          platform: "darwin",
          online: true,
          last_seen: null,
          this_device: false,
          threads: 0,
          listing: "incomplete",
        },
      ],
      remote_unavailable: "devices_unavailable",
    }
    const fake = fakeSdk({ list })
    const result = await run(["list", "--json"], fake)
    expect(result.calls.map((call) => call.method)).toEqual(["list"])
    expect(JSON.parse(result.stdout)).toEqual(list)
    expect({ exitCode: result.exitCode, disposed: result.disposed }).toEqual({ exitCode: THREAD_EXIT.ok, disposed: 1 })
  })

  test("#given threads on other devices #when list runs without --json #then each names its device and every device gets a line with its listing state", async () => {
    const result = await run(
      ["list"],
      fakeSdk({
        list: {
          kind: "ok",
          scope: "workspace",
          threads: [
            { thread: "dur-tui", surface: "tui", status: "live", name: "here", cwd: "/w" },
            { thread: "dur-on-b", status: "resumable", name: "on b", cwd: "/b", device: "dev-b" },
          ],
          devices: [
            {
              device: "dev-a",
              name: "this mac",
              platform: "darwin",
              online: true,
              last_seen: null,
              this_device: true,
              threads: 1,
              listing: "listed",
            },
            {
              device: "dev-b",
              name: "build box",
              platform: "linux",
              kind: "cli",
              online: true,
              last_seen: null,
              this_device: false,
              threads: 1,
              listing: "listed",
            },
            {
              device: "dev-c",
              name: "laptop",
              platform: "darwin",
              online: true,
              last_seen: null,
              this_device: false,
              threads: 0,
              listing: "incomplete",
            },
          ],
          remote_unavailable: "devices_unavailable",
        },
      }),
    )
    expect(result.stdout.split("\n").filter((line) => line !== "")).toEqual([
      "dur-tui  tui  live  here  /w",
      "dur-on-b  ?  resumable  on b  /b  on build box",
      "device this mac  darwin  this device  1 thread",
      "device build box  linux  online  1 thread",
      "device laptop  darwin  online  incomplete: its threads are missing from this list",
      "remote: devices_unavailable",
    ])
  })

  test("#given send with every addressing flag #when run #then the request carries exactly them, the turn as a number", async () => {
    const result = await run([
      "send",
      "my-tui",
      "ping",
      "--mode",
      "steer",
      "--expected-turn",
      "3",
      "--idempotency-key",
      "k-1",
      "--all-scope",
      "--json",
    ])
    expect(JSON.parse(result.stdout)).toEqual({
      kind: "ok",
      method: "send",
      request: {
        all_scope: true,
        thread: "my-tui",
        text: "ping",
        mode: "steer",
        expected_turn_id: 3,
        idempotency_key: "k-1",
      },
    })
  })

  test("#given list --state repeated and comma-separated #when run #then the SDK lists exactly those states, each once", async () => {
    const result = await run(["list", "--state", "archived,idle", "--state", "running", "--state", "idle", "--json"])
    expect(result.calls).toEqual([{ method: "list", request: { state: ["archived", "idle", "running"] } }])
  })

  test("#given list --state with a state that is not one of the four #when run #then it is a usage error and the SDK is never loaded", async () => {
    const result = await run(["list", "--state", "idle,live"])
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({ exitCode: THREAD_EXIT.usage, loaded: 0 })
    expect(result.stderr).toContain("--state must be one of running, idle, inactive, archived")
  })

  test("#given send text that reads --json after -- #when run #then it is sent as text and the output stays human", async () => {
    const result = await run(["send", "my-tui", "--", "--json"])
    expect({ exitCode: result.exitCode, text: (result.calls[0]?.request as { text?: string }).text }).toEqual({
      exitCode: THREAD_EXIT.ok,
      text: "--json",
    })
    expect(result.stdout.startsWith("sent: ")).toBe(true)
  })

  test("#given read --limit #when the transcript has more items #then only the newest ones are printed", async () => {
    const fake = fakeSdk({
      read: {
        kind: "ok",
        thread: "t",
        items: [
          { seq: 1, role: "user", content: "a" },
          { seq: 2, role: "assistant", content: "b" },
        ],
        truncated: false,
        source: "live_host",
      },
    })
    const result = await run(["read", "t", "--limit", "1", "--json"], fake)
    expect(JSON.parse(result.stdout).items).toEqual([{ seq: 2, role: "assistant", content: "b" }])
  })
})

describe("omo thread: exit codes", () => {
  test.each([
    ["scope_denied", THREAD_EXIT.refused],
    ["host_unavailable", THREAD_EXIT.unavailable],
    ["internal_error", THREAD_EXIT.failed],
  ])(
    "#given the SDK answers %s #when run with --json #then the error is on stdout and the exit code classifies it",
    async (code, exitCode) => {
      const fake = fakeSdk({ send: { kind: "error", error: { code, message: "m", next_action: "n" } } })
      const result = await run(["send", "my-tui", "ping", "--json"], fake)
      expect(result.exitCode).toBe(exitCode)
      expect(JSON.parse(result.stdout)).toEqual({ kind: "error", error: { code, message: "m", next_action: "n" } })
      expect(result.stderr).toContain(code)
    },
  )

  test.each([
    [["send", "only-target"], "expects 2 argument(s), got 1"],
    [["list", "--bogus"], "unknown option '--bogus'"],
    [["nope"], "unknown subcommand 'nope'"],
    [["send", "my-tui", "ping", "--mode", "bogus"], "--mode must be one of auto, steer, follow_up"],
    [["send", "my-tui", "   "], "<text> is empty"],
    [["send", "--binding", "b-1", "my-tui", "hi"], "unknown option '--binding'"],
    [["send", "my-tui", "hi", "--author-id", "U1"], "unknown option '--author-id'"],
  ])("#given %p #when run #then it is a usage error and the SDK is never loaded", async (args, message) => {
    const result = await run(args)
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({ exitCode: THREAD_EXIT.usage, loaded: 0 })
    expect(result.stderr).toContain(message)
    expect(result.stdout).toBe("")
  })

  // #14312: the binding verbs are gone, with no alias or deprecation path.
  test.each(["bind", "unbind", "rebind", "bindings", "report", "answer", "outbox", "ack"])(
    "#given the removed verb %s #when run #then it is an unknown subcommand and the SDK is never loaded",
    async (verb) => {
      const result = await run([verb, "--json"])
      expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({ exitCode: THREAD_EXIT.usage, loaded: 0 })
      expect(JSON.parse(result.stdout).error).toMatchObject({
        code: "invalid_arguments",
        message: `omo thread: unknown subcommand '${verb}'`,
      })
    },
  )

  test("#given --help #when run #then the usage names exactly list, send, read and close", async () => {
    const result = await run(["--help"])
    expect(result.stdout.split("\n")[0]).toBe("usage: omo thread <list|send|read|close> [options] [--json]")
    expect(result.stdout).not.toMatch(/\b(bind|unbind|rebind|bindings|report|answer|outbox|ack)\b|--binding/)
  })

  test.each([
    [
      "a usage error",
      ["send", "my-tui", "ping", "--mode", "bogus", "--json"],
      {},
      THREAD_EXIT.usage,
      "invalid_arguments",
    ],
    ["an unknown option", ["list", "--bogus", "--json"], {}, THREAD_EXIT.usage, "invalid_arguments"],
    ["win32", ["list", "--json"], { platform: "win32" }, THREAD_EXIT.unsupported, "unsupported"],
    [
      "no node:sqlite",
      ["list", "--json"],
      {
        loadSqlite: async () => {
          throw new Error("No such built-in module: node:sqlite")
        },
      },
      THREAD_EXIT.unsupported,
      "unsupported",
    ],
  ])(
    "#given %s with --json #when run #then stdout is still one error JSON value",
    async (_label, args, extra, exitCode, code) => {
      const result = await run(args, fakeSdk(), extra)
      expect(result.exitCode).toBe(exitCode)
      const printed = JSON.parse(result.stdout)
      expect({ kind: printed.kind, code: printed.error.code }).toEqual({ kind: "error", code })
      expect(typeof printed.error.next_action).toBe("string")
    },
  )

  test("#given win32 #when any subcommand runs #then it is refused as unsupported like omo daemon", async () => {
    const result = await run(["list"], fakeSdk(), { platform: "win32" })
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({
      exitCode: THREAD_EXIT.unsupported,
      loaded: 0,
    })
    expect(result.stderr).toContain("win32")
  })

  test("#given a runtime without node:sqlite #when a subcommand runs #then it is a named refusal before the SDK loads", async () => {
    const result = await run(["list"], fakeSdk(), {
      loadSqlite: async () => {
        throw new Error("No such built-in module: node:sqlite")
      },
    })
    expect({ exitCode: result.exitCode, loaded: result.loaded }).toEqual({
      exitCode: THREAD_EXIT.unsupported,
      loaded: 0,
    })
    expect(result.stderr).toContain("node:sqlite is unavailable")
  })
})

describe("omo thread: SDK loading", () => {
  test("#given a plugin whose thread SDK cannot be imported #when a --json command runs #then stdout is one internal_error JSON value naming the caller's reinstall step and the exit code is 5", async () => {
    const reinstall = "Reinstall omo with: npm i -g omo-ai@beta, then retry."
    const result = await run(["list", "--json"], fakeSdk(), {
      reinstall,
      importSdk: async () => {
        throw new Error("Cannot find module sdk.js")
      },
    })
    expect(result.exitCode).toBe(THREAD_EXIT.failed)
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: "error",
      error: { code: "internal_error", next_action: reinstall },
    })
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
  })

  test("#given an SDK whose dispose rejects #when a command succeeds #then its result and exit code stand and the failure is logged on stderr", async () => {
    const fake = fakeSdk({ list: { kind: "ok", scope: "workspace", threads: [] } })
    const failing = {
      ...fake,
      sdk: {
        ...fake.sdk,
        dispose: async () => {
          throw new Error("worker gone")
        },
      },
    }
    const result = await run(["list", "--json"], failing)
    expect({ exitCode: result.exitCode, stdout: JSON.parse(result.stdout) }).toEqual({
      exitCode: THREAD_EXIT.ok,
      stdout: { kind: "ok", scope: "workspace", threads: [] },
    })
    expect(result.stderr).toContain("worker gone")
  })

  test("#given the plugin SDK #when loaded #then it gets the agent dir, cwd and cli identity, and no engine status reader: endpoints come from the registry", async () => {
    let received: Record<string, unknown> = {}
    const loaded = await loadThreadSdk({
      pluginRoot: "/plugin",
      agentDir: "/agent",
      env: { KEEP: "1" },
      cwd: "/work",
      stderr: { write: () => {} },
      reinstall: "Reinstall omo, then retry.",
      loadSqlite: async () => ({}),
      importSdk: async () => ({
        createThreadSdk: (options: Record<string, unknown>) => {
          received = options
          return {}
        },
      }),
      importThreadClient: async () => ({}),
      identity: { uid: 501, user: "qa" },
    })
    expect(loaded.error).toBeUndefined()
    expect({ agentDir: received.agentDir, cwd: received.cwd, uid: received.uid, user: received.user }).toEqual({
      agentDir: "/agent",
      cwd: "/work",
      uid: 501,
      user: "qa",
    })
    expect("engineStatusAll" in received).toBe(false)
    expect("remote" in received).toBe(false)
  })

  test("#given a plugin thread client that offers the CLI remote surface #when the SDK loads #then the SDK reads through that surface, whose sign-in loads only when an alias is used (#12833)", async () => {
    let received: Record<string, unknown> = {}
    let offered: Record<string, unknown> = {}
    const surface = { sessions: {}, chain: {} }
    const loaded = await loadThreadSdk({
      pluginRoot: "/plugin",
      agentDir: "/agent",
      env: {},
      cwd: "/work",
      stderr: { write: () => {} },
      reinstall: "Reinstall omo, then retry.",
      loadSqlite: async () => ({}),
      importSdk: async () => ({
        createThreadSdk: (options: Record<string, unknown>) => {
          received = options
          return {}
        },
      }),
      importThreadClient: async () => ({
        createCliRemoteSurface: (options: Record<string, unknown>) => {
          offered = options
          return surface
        },
      }),
      identity: { uid: 501, user: "qa" },
    })
    expect(loaded.error).toBeUndefined()
    expect(received.remote).toBe(surface)
    expect(typeof offered.loadAccess).toBe("function")
  })
})
