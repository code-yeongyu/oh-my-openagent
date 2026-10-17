import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { runDaemonCommand } from "../bin/lib/daemon.js"
import { capture, endpoint, scriptedEngine, workspace } from "./daemon-test-support"

/**
 * Kind-aware lifecycle: a terminal (`tui`) endpoint is listed by status but owned by its terminal,
 * so handoff, stop --all and its wait never call the engine for it. Mixed fixture: one reachable
 * host, one reachable terminal, one dead terminal.
 */

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function terminal(socket: string, options: { readonly alive: boolean; readonly name: string; readonly pid: number }) {
  return {
    ...endpoint(socket, { reachable: options.alive, pid: options.pid, sessions: 1, claimsLive: options.alive ? 1 : 0 }),
    endpoint_kind: "tui",
    alive: options.alive,
    reason: options.alive ? null : "dead",
    owner: { pid: options.pid, cwd: "/work/repo", session: { id: `dur-${options.name}`, path: `/sessions/${options.name}.jsonl`, name: options.name } },
  }
}

function fixture() {
  const result = workspace()
  roots.push(result.root)
  const host = { ...endpoint(join(result.agentDir, "rpc", "shards", "i-aaaaaaaaaaaaaaaa.sock"), { pid: 11, sessions: 2, shard: { kind: "i", key: "aaaaaaaaaaaaaaaa" } }), endpoint_kind: "rpc_host", alive: true, reason: null, owner: null }
  const liveTui = terminal(join(result.agentDir, "rpc", "tui", "t-bbbbbbbbbbbbbbbb.sock"), { alive: true, name: "my-tui", pid: 21 })
  const deadTui = terminal(join(result.agentDir, "rpc", "tui", "t-cccccccccccccccc.sock"), { alive: false, name: "gone-tui", pid: 31 })
  return { ...result, host, liveTui, deadTui, endpoints: [host, liveTui, deadTui] }
}

function run(f: ReturnType<typeof fixture>, args: readonly string[], engine: ReturnType<typeof scriptedEngine>, pauses: number[] = []) {
  const stdout = capture()
  const exitCode = runDaemonCommand([...args], {
    engine,
    pluginRoot: f.pluginRoot,
    agentDir: f.agentDir,
    env: {},
    stdout,
    stderr: capture(),
    platform: "darwin",
    now: () => 0,
    pause: (ms: number) => void pauses.push(ms),
  })
  return { exitCode, stdout: stdout.text() }
}

const statusAll = (args: readonly string[]) => args.join(" ") === "host status --json --all --include-workers"
const touchesTerminal = (calls: readonly { args: readonly string[] }[]) => calls.some((call) => call.args.some((arg) => arg.includes("/tui/")))

describe("omo daemon lifecycle over a mixed fixture", () => {
  test("#given a host and two terminals #when status runs #then all three are listed, terminals as tui rows, and only the host counts as a live host", () => {
    const f = fixture()
    const engine = scriptedEngine(() => ({ exitCode: 0, stdout: JSON.stringify({ endpoints: f.endpoints }) }))
    const text = run(f, ["status"], engine).stdout
    expect(text).toContain("thread i-aaaaaaaaaaaaaaaa: running pid 11")
    expect(text).toContain("tui my-tui pid 21 cwd /work/repo\n")
    expect(text).toContain("tui gone-tui pid 31 cwd /work/repo: not responding (dead;")
    expect(text).toContain("hosts: 1 live (0 shards, 1 threads) · 1 terminal(s) · 2 session(s)")
    const json = JSON.parse(run(f, ["status", "--json"], engine).stdout)
    expect(json.endpoints.map((row: { endpoint_kind: string }) => row.endpoint_kind)).toEqual(["rpc_host", "tui", "tui"])
    expect(json.aggregate).toMatchObject({ live: 1, terminals: 1, sessions: 2 })
  })

  test("#given a host and two terminals #when handoff runs #then the engine is called for the host only and the terminals are reported skipped", () => {
    const f = fixture()
    const engine = scriptedEngine((args) => (statusAll(args) ? { exitCode: 0, stdout: JSON.stringify({ endpoints: f.endpoints }) } : { exitCode: 0, stdout: JSON.stringify({ action: "reuse", pid: 11 }) }))
    const result = run(f, ["handoff"], engine)
    expect(result.exitCode).toBe(0)
    expect(engine.calls.filter((call) => !statusAll(call.args)).map((call) => call.args.slice(0, 5))).toEqual([["host", "ensure", "--json", "--socket", f.host.socket]])
    expect(touchesTerminal(engine.calls)).toBe(false)
    expect(result.stdout).toContain(`${f.liveTui.socket}: skipped (tui endpoint, owned by its terminal)`)
    expect(result.stdout).toContain(`${f.deadTui.socket}: skipped (tui endpoint, owned by its terminal)`)
  })

  test("#given a host and a live terminal holding a claim #when stop --drain --all --wait runs #then only the host is stopped and awaited, and the wait ends on its drained status without pausing", () => {
    const f = fixture()
    let stopped = false
    const engine = scriptedEngine((args) => {
      if (statusAll(args)) return { exitCode: 0, stdout: JSON.stringify({ endpoints: f.endpoints }) }
      if (args[1] === "stop") {
        stopped = true
        return { exitCode: 0, stdout: JSON.stringify({ action: "drain", pid: 11 }) }
      }
      const drained = { ...f.host, generations: [{ ...f.host.generations[0], alive: !stopped }], claims_live: stopped ? 0 : 1 }
      return { exitCode: 0, stdout: JSON.stringify(drained) }
    })
    const pauses: number[] = []
    const result = run(f, ["stop", "--drain", "--all", "--wait"], engine, pauses)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`${f.host.socket}: drained (1 polls)`)
    expect(engine.calls.filter((call) => call.args[1] === "stop").map((call) => call.args)).toEqual([["host", "stop", "--json", "--socket", f.host.socket, "--drain"]])
    expect(touchesTerminal(engine.calls)).toBe(false)
    expect(pauses).toEqual([])
  })

  test("#given a dead and a live terminal #when gc runs #then the engine's evidence verdict is reported as-is with the plain gc command", () => {
    const f = fixture()
    const engine = scriptedEngine(() => ({ exitCode: 0, stdout: JSON.stringify({ removed: [{ socket: f.deadTui.socket }], kept: [{ socket: f.liveTui.socket }] }) }))
    const result = run(f, ["gc", "--json"], engine)
    expect(engine.calls.map((call) => call.args)).toEqual([["host", "gc", "--json"]])
    expect(JSON.parse(result.stdout)).toMatchObject({ removed: [{ socket: f.deadTui.socket }], kept: [{ socket: f.liveTui.socket }] })
  })
})
