import { describe, expect, test } from "bun:test"

import { DAEMON_EXIT, runDaemonCommand } from "../bin/lib/daemon.js"

/**
 * `omo daemon adopt` against a fake host implementing senpi's `release_session` contract (rpc.md
 * "Handing a session over"): the refusal codes map to exit codes and messages, dropped user input
 * is replayed in the adopting terminal or printed, and `release_failed` then `unknown_session`
 * counts as released.
 */

type Reply = Record<string, unknown>

const HOST = { kind: "rpc_host", socket: "/agent/rpc/shards/i-0123456789abcdef.sock", routing_id: "rpc-1" }
const HOST_THREAD = { thread_id: "dur-host", title: "host lane", cwd: "/work/repo", status: "live", session_path: "/sessions/dur-host.jsonl", endpoint: HOST, surface: "desktop", alive: true }
const TUI_THREAD = { ...HOST_THREAD, thread_id: "dur-tui", surface: "tui", endpoint: { kind: "tui", socket: "/agent/rpc/tui/t-0123456789abcdef.sock", routing_id: "dur-tui" } }
const RELEASED = { success: true, data: { released: true, session_path: "/sessions/dur-host.jsonl", attachments: 0, dropped: { deliveries: [], user_messages: [] } } }

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

async function adopt(args: readonly string[], options: { readonly located?: Reply; readonly replies?: readonly Reply[]; readonly platform?: string } = {}) {
  const releases: Reply[] = []
  const replies = [...(options.replies ?? [RELEASED])]
  let disposed = 0
  const sdk = {
    locate: async () => options.located ?? { kind: "ok", thread: HOST_THREAD },
    release: async (_thread: unknown, request: Reply) => {
      releases.push(request)
      return replies.shift() ?? { success: false, error: "unknown_session" }
    },
    dispose: async () => void disposed++,
  }
  const stdout = capture()
  const stderr = capture()
  const outcome = await runDaemonCommand(["adopt", ...args], {
    engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    pluginRoot: "/plugin",
    agentDir: "/agent",
    env: {},
    stdout,
    stderr,
    platform: options.platform ?? "darwin",
    threadSdk: async () => ({ sdk }),
  })
  return { outcome, releases, disposed, stdout: stdout.text(), stderr: stderr.text() }
}

describe("omo daemon adopt", () => {
  test("#given a quiet host session #when adopted #then it is released as a takeover and resumed with --session in its own directory", async () => {
    const result = await adopt(["dur-host"])
    expect(result.releases).toEqual([{}])
    expect(result.outcome).toEqual({ launch: ["--session", "/sessions/dur-host.jsonl"], cwd: "/work/repo" })
    expect(result.disposed).toBe(1)
  })

  test("#given --interrupt took queued input out #when released #then the messages become the terminal's first prompts, and one starting with @ is printed instead", async () => {
    const released = { success: true, data: { released: true, session_path: "/sessions/dur-host.jsonl", attachments: 0, dropped: { deliveries: ["d-1"], user_messages: ["first ask", "", "@notes.md please", "   ", "second ask"] } } }
    const result = await adopt(["dur-host", "--interrupt", "--json"], { replies: [released] })
    expect(result.releases).toEqual([{ interrupt: true }])
    expect(result.outcome).toEqual({ launch: ["--session", "/sessions/dur-host.jsonl", "--", "first ask", "second ask"], cwd: "/work/repo" })
    expect(result.stderr).toContain("@notes.md please")
    expect(result.stderr).toContain("1 gateway delivery returns")
    expect(JSON.parse(result.stdout)).toMatchObject({ kind: "released", dropped: { deliveries: ["d-1"] } })
  })

  test("#given a terminal session #when adopted #then it exits 4 already a terminal session and nothing is released", async () => {
    const result = await adopt(["dur-tui"], { located: { kind: "ok", thread: TUI_THREAD } })
    expect(result.outcome).toBe(DAEMON_EXIT.unsupported)
    expect(result.stderr).toContain("already a terminal session")
    expect(result.releases).toEqual([])
  })

  test("#given a streaming session and no --interrupt #when adopted #then it exits 4 turn_active and names --interrupt", async () => {
    const refused = { success: false, error: "turn_active", errorData: { attachments: 0, busy: ["turn", "queued"], retry_with: { interrupt: true }, hint: "h" } }
    const result = await adopt(["dur-host"], { replies: [refused] })
    expect(result.outcome).toBe(DAEMON_EXIT.unsupported)
    expect(result.stderr).toContain("turn_active")
    expect(result.stderr).toContain("pass --interrupt")
  })

  test("#given --interrupt was passed #when the host still answers turn_active with retry_with #then the message never asks for --interrupt again", async () => {
    const refused = { success: false, error: "turn_active", errorData: { attachments: 0, busy: ["turn"], retry_with: { interrupt: true }, interrupted: true } }
    const result = await adopt(["dur-host", "--interrupt"], { replies: [refused] })
    expect(result.outcome).toBe(DAEMON_EXIT.unsupported)
    expect(result.stderr).toContain("still busy after the interrupt")
    expect(result.stderr).not.toContain("pass --interrupt")
  })

  test("#given a client attached #when adopted without then with --force #then the first exits 4 attached with the count and the second forces the release", async () => {
    const attached = { success: false, error: "attached", errorData: { attachments: 2 } }
    const refused = await adopt(["dur-host"], { replies: [attached] })
    expect(refused.outcome).toBe(DAEMON_EXIT.unsupported)
    expect(refused.stderr).toContain("attached: 2 client(s) - a Desktop thread or another client owns it; pass --force to take it anyway")
    const forced = await adopt(["dur-host", "--force"])
    expect(forced.releases).toEqual([{ force: true }])
    expect(forced.outcome).toMatchObject({ launch: ["--session", "/sessions/dur-host.jsonl"] })
  })

  test("#given a refusal after the interrupt emptied the queues #when adopted #then the dropped user input is printed and reported, never lost", async () => {
    const refused = { success: false, error: "attached", errorData: { attachments: 1, interrupted: true, dropped: { deliveries: ["d-2"], user_messages: ["keep me"] } } }
    const result = await adopt(["dur-host", "--interrupt", "--json"], { replies: [refused] })
    expect(result.outcome).toBe(DAEMON_EXIT.unsupported)
    expect(result.stderr).toContain("not delivered: keep me")
    expect(JSON.parse(result.stdout)).toEqual({ kind: "refused", error: "attached", thread_id: "dur-host", dropped: { deliveries: ["d-2"], user_messages: ["keep me"] } })
  })

  test("#given release_failed #when the second ask answers unknown_session #then the session counts as released at its known path", async () => {
    const failed = { success: false, error: "release_failed", errorData: { detail: "EACCES" } }
    const result = await adopt(["dur-host"], { replies: [failed, { success: false, error: "unknown_session" }] })
    expect(result.releases).toEqual([{}, {}])
    expect(result.outcome).toEqual({ launch: ["--session", "/sessions/dur-host.jsonl"], cwd: "/work/repo" })
  })

  test("#given release_failed twice #when adopted #then it exits 5 with the detail and the session stays on the host", async () => {
    const failed = { success: false, error: "release_failed", errorData: { detail: "ENOSPC" } }
    const result = await adopt(["dur-host"], { replies: [failed, failed] })
    expect(result.outcome).toBe(DAEMON_EXIT.engineRefused)
    expect(result.stderr).toContain("release_failed: ENOSPC")
  })

  test.each([
    ["session_busy", DAEMON_EXIT.unsupported],
    ["host_draining", DAEMON_EXIT.unsupported],
    ["session_closing", DAEMON_EXIT.unsupported],
    ["release_unsupported", DAEMON_EXIT.unsupported],
    ["unknown_session", DAEMON_EXIT.notRunning],
    ["host_unavailable", DAEMON_EXIT.notRunning],
  ])("#given the host answers %s #when adopted #then the exit code is %d", async (error, exitCode) => {
    const result = await adopt(["dur-host"], { replies: [{ success: false, error }] })
    expect(result.outcome).toBe(exitCode)
    expect(result.stderr).toContain(error)
  })

  test("#given an unknown session or one no host serves #when adopted #then it exits 3 without a release", async () => {
    const missing = await adopt(["nope"], { located: { kind: "error", error: { code: "not_found", message: "no thread", next_action: "n" } } })
    const dead = await adopt(["dur-host"], { located: { kind: "ok", thread: { ...HOST_THREAD, alive: false } } })
    expect([missing.outcome, dead.outcome]).toEqual([DAEMON_EXIT.notRunning, DAEMON_EXIT.notRunning])
    expect([...missing.releases, ...dead.releases]).toEqual([])
  })

  test("#given win32 or no session argument #when adopted #then it is refused before the SDK loads", async () => {
    const windows = await adopt(["dur-host"], { platform: "win32" })
    const missing = await adopt([])
    expect([windows.outcome, missing.outcome]).toEqual([DAEMON_EXIT.unsupported, DAEMON_EXIT.usage])
    expect(windows.disposed).toBe(0)
  })
})
