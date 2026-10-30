import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import { runDaemonCommand } from "../bin/lib/daemon.js"
import { capture, endpoint, scriptedEngine, workspace, writeJson } from "./daemon-test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const result = workspace()
  roots.push(result.root)
  const shardRoot = join(result.agentDir, "rpc", "shards")
  return {
    ...result,
    endpoints: [
      endpoint(join(result.agentDir, "rpc", "rpc.sock"), { pid: 1 }),
      endpoint(join(shardRoot, "p-aaaaaaaaaaaaaaaa.sock"), {
        pid: 2,
        shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
      }),
      endpoint(join(shardRoot, "i-bbbbbbbbbbbbbbbb.sock"), {
        pid: 3,
        shard: { kind: "i", key: "bbbbbbbbbbbbbbbb" },
      }),
      endpoint(join(result.agentDir, "rpc", "desk.sock"), { pid: 4 }),
      endpoint(join(shardRoot, "p-cccccccccccccccc.sock"), {
        reachable: false,
        shard: { kind: "p", key: "cccccccccccccccc" },
      }),
    ],
  }
}

describe("omo daemon endpoint lifecycle", () => {
  test("#given daemon shard thread extra and dead endpoints #when handoff runs #then every live endpoint uses the correct engine path", () => {
    const { pluginRoot, agentDir, endpoints } = fixture()
    const engine = scriptedEngine((args) => {
      if (args.includes("--all")) return { exitCode: 0, stdout: JSON.stringify({ endpoints }) }
      const socketIndex = args.indexOf("--socket")
      const socket = socketIndex === -1 ? join(agentDir, "rpc", "rpc.sock") : args[socketIndex + 1]
      const action = socket?.endsWith("i-bbbbbbbbbbbbbbbb.sock") ? "refuse" : "reuse"
      return { exitCode: action === "refuse" ? 3 : 0, stdout: JSON.stringify({ action }) }
    })
    const stdout = capture()

    const exitCode = runDaemonCommand(["handoff"], {
      engine, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    expect(exitCode).toBe(3)
    expect(engine.calls.filter((call) => call.args[1] === "handoff")).toHaveLength(1)
    const ensuredSockets = engine.calls
      .filter((call) => call.args[1] === "ensure")
      .map((call) => call.args[call.args.indexOf("--socket") + 1])
    expect(ensuredSockets).toEqual([
      endpoints[1]?.socket,
      endpoints[2]?.socket,
      endpoints[3]?.socket,
    ])
    expect(stdout.text()).toContain(`${endpoints[2]?.socket}: refuse`)
  })

  test("#given task.host_idle_exit_ms #when handoff fans out #then every host action receives the supported env override", () => {
    const { pluginRoot, agentDir, endpoints } = fixture()
    writeJson(join(agentDir, "omo.json"), { task: { host_idle_exit_ms: 12_345 } })
    const engine = scriptedEngine((args) => args.includes("--all")
      ? { exitCode: 0, stdout: JSON.stringify({ endpoints }) }
      : { exitCode: 0, stdout: JSON.stringify({ action: "reuse" }) })

    const exitCode = runDaemonCommand(["handoff"], {
      engine, pluginRoot, agentDir, env: {}, stdout: capture(), stderr: capture(), platform: "darwin",
    })

    expect(exitCode).toBe(0)
    for (const call of engine.calls.filter((entry) => entry.args[1] === "handoff" || entry.args[1] === "ensure")) {
      expect(call.args).not.toContain("--idle-exit-ms")
      expect(call.env.SENPI_RPC_HOST_IDLE_EXIT_MS).toBe("12345")
    }
  })

  test("#given four owned endpoints #when stop --all runs without wait #then each endpoint gets one stop request", () => {
    const { pluginRoot, agentDir, endpoints } = fixture()
    const engine = scriptedEngine((args) => args.includes("--all")
      ? { exitCode: 0, stdout: JSON.stringify({ endpoints }) }
      : { exitCode: 0, stdout: JSON.stringify({ action: "stopped" }) })
    const stdout = capture()

    const exitCode = runDaemonCommand(["stop", "--all"], {
      engine, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    const stopCalls = engine.calls.filter((call) => call.args[1] === "stop")
    expect(exitCode).toBe(0)
    expect(stopCalls).toHaveLength(4)
    expect(stopCalls.map((call) => call.args[call.args.indexOf("--socket") + 1])).toEqual(
      endpoints.slice(0, 4).map((endpoint) => endpoint.socket),
    )
    expect(stdout.text().match(/requested \(not awaited\)/g)).toHaveLength(4)
  })

  test("#given removed and kept endpoint metadata #when gc runs #then only removed metadata is reaped", () => {
    const { pluginRoot, agentDir, endpoints } = fixture()
    const removedSocket = endpoints[1]?.socket
    const keptSocket = endpoints[2]?.socket
    if (typeof removedSocket !== "string" || typeof keptSocket !== "string") throw new Error("fixture sockets missing")
    const removedMeta = removedSocket.replace(/\.sock$/, ".meta.json")
    const keptMeta = keptSocket.replace(/\.sock$/, ".meta.json")
    writeJson(removedMeta, { socket: removedSocket })
    writeJson(keptMeta, { socket: keptSocket })
    const engine = scriptedEngine(() => ({
      exitCode: 0,
      stdout: JSON.stringify({
        removed: [{ socket: removedSocket, dir: `${removedSocket}.state`, reason: "silent" }],
        kept: [{ socket: keptSocket, dir: `${keptSocket}.state`, reason: "pid_alive" }],
      }),
    }))
    const stdout = capture()

    const exitCode = runDaemonCommand(["gc", "--json"], {
      engine, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    const payload = JSON.parse(stdout.text())
    expect(exitCode).toBe(0)
    expect(payload.reaped_meta).toEqual([removedMeta])
    expect(existsSync(removedMeta)).toBe(false)
    expect(existsSync(keptMeta)).toBe(true)
  })

  test("#given a draining endpoint that releases on the third poll #when stop waits #then completion ignores reachability", () => {
    const { pluginRoot, agentDir } = fixture()
    const socket = join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock")
    const initial = endpoint(socket, {
      pid: 2,
      sessions: 1,
      claimsLive: 1,
      shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
    })
    let polls = 0
    const engine = scriptedEngine((args) => {
      if (args.includes("--all")) return { exitCode: 0, stdout: JSON.stringify({ endpoints: [initial] }) }
      if (args[1] === "stop") return { exitCode: 0, stdout: JSON.stringify({ action: "drained" }) }
      polls += 1
      if (polls < 3) {
        return {
          exitCode: 3,
          stdout: JSON.stringify({ ...initial, reachable: false, claims_live: 1 }),
        }
      }
      return {
        exitCode: 3,
        stdout: JSON.stringify({
          ...initial,
          reachable: false,
          pid: null,
          claims_live: 0,
          sessions: { ...initial.sessions, total: 0 },
          generations: initial.generations.map((generation) => ({ ...generation, alive: false })),
        }),
      }
    })
    const stdout = capture()
    let clock = 0

    const exitCode = runDaemonCommand(["stop", "--drain", "--all", "--wait", "--timeout", "5"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
      now: () => clock,
      pause: (milliseconds: number) => {
        clock += milliseconds
      },
    })

    expect(exitCode).toBe(0)
    expect(polls).toBe(3)
    expect(stdout.text()).toContain("drained (3 polls)")
  })

  test("#given an endpoint that never releases #when the drain wait times out #then it exits three with ownership evidence", () => {
    const { pluginRoot, agentDir } = fixture()
    const live = endpoint(join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock"), {
      pid: 2,
      sessions: 1,
      claimsLive: 1,
      shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
    })
    const engine = scriptedEngine((args) => {
      if (args.includes("--all")) return { exitCode: 0, stdout: JSON.stringify({ endpoints: [live] }) }
      if (args[1] === "stop") return { exitCode: 0, stdout: JSON.stringify({ action: "drained" }) }
      return { exitCode: 0, stdout: JSON.stringify(live) }
    })
    let clock = 0
    const stdout = capture()

    const exitCode = runDaemonCommand(["stop", "--drain", "--all", "--wait", "--timeout", "1"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
      now: () => clock,
      pause: (milliseconds: number) => {
        clock += milliseconds
      },
    })

    expect(exitCode).toBe(3)
    expect(stdout.text()).toContain("TIMEOUT: still live (pid 2, 1 sessions, 1 claims)")
  })

})
