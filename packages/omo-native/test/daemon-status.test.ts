import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { daemonReportLines, runDaemonCommand } from "../bin/lib/daemon.js"
import { capture, endpoint, scriptedEngine, workspace, writeJson } from "./daemon-test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const result = workspace()
  roots.push(result.root)
  const shardRoot = join(result.agentDir, "rpc", "shards")
  const daemon = endpoint(join(result.agentDir, "rpc", "rpc.sock"), {
    pid: 11,
    sessions: 1,
    rss: 20,
    hostRss: 15,
  })
  const shard = endpoint(join(shardRoot, "p-aaaaaaaaaaaaaaaa.sock"), {
    pid: 21,
    sessions: 2,
    rss: 30,
    hostRss: 22,
    fds: 9,
    crashes: 2,
    engineVersion: "shard-engine",
    shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
    generations: [
      {
        instanceId: "old",
        generation: 1,
        pid: 20,
        engineVersion: "old",
        rss_mb: 12,
        host_rss_mb: 8,
        sessions: 1,
        current: false,
        alive: true,
      },
      {
        instanceId: "new",
        generation: 2,
        pid: 21,
        engineVersion: "new",
        rss_mb: 30,
        host_rss_mb: 22,
        sessions: 2,
        current: true,
        alive: true,
      },
    ],
  })
  const thread = endpoint(join(shardRoot, "i-bbbbbbbbbbbbbbbb.sock"), {
    pid: 31,
    sessions: 1,
    rss: 40,
    hostRss: 25,
    crashes: 0,
    engineVersion: "thread-engine",
    shard: { kind: "i", key: "bbbbbbbbbbbbbbbb" },
  })
  const extra = endpoint(join(result.agentDir, "rpc", "desk.sock"), { pid: 41, sessions: 1 })
  const dead = endpoint(join(shardRoot, "p-cccccccccccccccc.sock"), {
    reachable: false,
    shard: { kind: "p", key: "cccccccccccccccc" },
  })
  writeJson(join(shardRoot, "p-aaaaaaaaaaaaaaaa.meta.json"), {
    owner_session_id: "parent-session-1234",
    owner_session_file: "/tmp/parent-session.jsonl",
  })
  writeJson(join(shardRoot, "i-bbbbbbbbbbbbbbbb.meta.json"), { owner_session_id: "thread-session-5678" })
  return { ...result, endpoints: [daemon, shard, thread, extra, dead] }
}

describe("omo daemon multi-endpoint status", () => {
  test("#given every endpoint kind #when text status runs #then each row and generation contributes to the aggregate", () => {
    const { pluginRoot, agentDir, endpoints } = fixture()
    const engine = scriptedEngine(() => ({ exitCode: 0, stdout: JSON.stringify({ endpoints }) }))
    const stdout = capture()

    const exitCode = runDaemonCommand(["status"], {
      engine, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    expect(exitCode).toBe(0)
    expect(engine.calls).toHaveLength(1)
    expect(engine.calls[0]?.args).toEqual(["host", "status", "--json", "--all", "--include-workers"])
    expect(stdout.text()).toContain("daemon: running pid 11")
    expect(stdout.text()).toContain("shard p-aaaaaaaaaaaaaaaa (parent parent-s, parent-session.jsonl)")
    expect(stdout.text()).toContain("thread i-bbbbbbbbbbbbbbbb (thread thread-s)")
    expect(stdout.text()).toContain("endpoint desk.sock:")
    expect(stdout.text()).toContain("gen 1 (draining) pid 20 · engine old · 1 session(s) · rss 12 MB (host 8 MB)")
    expect(stdout.text()).toContain("gen 2 (current) pid 21 · engine new · 2 session(s) · rss 30 MB (host 22 MB)")
    expect(stdout.text()).toContain("not running (retained state kept; run omo daemon gc)")
    expect(stdout.text()).toContain("hosts: 4 live (1 shards, 1 threads) · 5 session(s) · rss 100 MB (host 70 MB) · crashes 2")
  })

  test("#given engine rows with memory fields #when json status runs #then fields remain unchanged and owners are joined", () => {
    const { pluginRoot, agentDir, endpoints } = fixture()
    const engine = scriptedEngine(() => ({ exitCode: 0, stdout: JSON.stringify({ endpoints }) }))
    const stdout = capture()

    runDaemonCommand(["status", "--json"], {
      engine, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    const payload = JSON.parse(stdout.text())
    expect(payload.endpoints[1].host_rss_mb).toBe(22)
    expect(payload.endpoints[1].generations[0].host_rss_mb).toBe(8)
    expect(payload.endpoints[1].owner.owner_session_id).toBe("parent-session-1234")
    expect(payload.aggregate.live).toBe(4)
  })

  test("#given the adopted all-endpoint engine #when doctor runs #then it prints every endpoint and aggregate", () => {
    const { agentDir, endpoints } = fixture()
    const engine = scriptedEngine(() => ({ exitCode: 0, stdout: JSON.stringify({ endpoints }) }))

    const lines = daemonReportLines({ engine, pluginRoot: "/p", agentDir, env: {}, platform: "darwin" })

    const shardLine = lines.find((line) => line.startsWith("INFO Shard p-aaaaaaaaaaaaaaaa"))
    const threadLine = lines.find((line) => line.startsWith("INFO Thread i-bbbbbbbbbbbbbbbb"))
    expect(shardLine).toContain("parent parent-s, parent-session.jsonl")
    expect(shardLine).toContain("engine shard-engine")
    expect(shardLine).toContain("crashes 2")
    expect(threadLine).toContain("thread thread-s")
    expect(threadLine).toContain("engine thread-engine")
    expect(threadLine).toContain("crashes 0")
    expect(lines.some((line) => line.startsWith("WARN Shard p-cccccccccccccccc"))).toBe(true)
    expect(lines.at(-1)).toContain("INFO Hosts: 4 live")
  })

  test("#given a pre-all engine #when doctor runs #then it preserves the single-daemon row and reports degradation", () => {
    const status = { pid: 42, instanceId: "legacy", engineVersion: "old", sessions: { total: 3 }, zombies: 0 }
    const engine = scriptedEngine((args) => args.includes("--all")
      ? { exitCode: 2, stderr: "usage" }
      : { exitCode: 0, stdout: JSON.stringify(status) })

    const lines = daemonReportLines({ engine, pluginRoot: "/p", agentDir: "/a", env: {}, platform: "darwin" })

    expect(lines[0]).toContain("INFO Daemon: running pid 42")
    expect(lines[1]).toBe("INFO Hosts: engine too old to enumerate")
  })

  test("#given an empty adopted engine #when text status runs #then it exits three without endpoint rows", () => {
    const { pluginRoot, agentDir } = fixture()
    const engine = scriptedEngine(() => ({ exitCode: 3, stdout: JSON.stringify({ endpoints: [] }) }))
    const stdout = capture()

    const exitCode = runDaemonCommand(["status"], {
      engine, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    expect(exitCode).toBe(3)
    expect(stdout.text()).toBe("daemon: not running\n")
  })
})
