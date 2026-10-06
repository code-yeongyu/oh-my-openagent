import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { runDaemonCommand } from "../bin/lib/daemon.js"
import { capture, endpoint, scriptedEngine, workspace } from "./daemon-test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const result = workspace()
  roots.push(result.root)
  return result
}

describe("omo daemon drain wait ownership evidence", () => {
  test("#given an endpoint with no live generation or claim #when drain is already unsupported #then it is already drained", () => {
    const { pluginRoot, agentDir } = fixture()
    const drained = {
      ...endpoint(join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock"), {
        shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
        generations: [],
      }),
      generations: [],
    }
    const engine = scriptedEngine((args) => args.includes("--all")
      ? { exitCode: 0, stdout: JSON.stringify({ endpoints: [drained] }) }
      : { exitCode: 3, stdout: JSON.stringify({ action: "refuse", reason: "drain_unsupported" }) })
    const stdout = capture()

    const exitCode = runDaemonCommand(["stop", "--drain", "--all", "--wait"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
      now: () => 0,
      pause: () => {
        throw new Error("already drained must not poll")
      },
    })

    expect(exitCode).toBe(0)
    expect(stdout.text()).toContain("already drained")
    expect(engine.calls.filter((call) => call.args[1] === "status" && call.args.includes("--socket"))).toHaveLength(0)
  })

  test("#given an already-draining live endpoint #when wait repeats stop #then the refusal becomes a wait-only continuation", () => {
    const { pluginRoot, agentDir } = fixture()
    const live = {
      ...endpoint(join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock"), {
        pid: 2,
        claimsLive: 1,
        shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
      }),
      reachable: false,
    }
    let polls = 0
    const engine = scriptedEngine((args) => {
      if (args.includes("--all")) return { exitCode: 0, stdout: JSON.stringify({ endpoints: [live] }) }
      if (args[1] === "stop") {
        return { exitCode: 3, stdout: JSON.stringify({ action: "refuse", reason: "drain_unsupported" }) }
      }
      polls += 1
      return polls === 1
        ? { exitCode: 3, stdout: JSON.stringify({ ...live, reachable: false }) }
        : {
            exitCode: 3,
            stdout: JSON.stringify({
              ...live,
              reachable: false,
              claims_live: 0,
              generations: live.generations.map((generation) => ({ ...generation, alive: false })),
            }),
          }
    })
    const stdout = capture()
    let clock = 0

    const exitCode = runDaemonCommand(["stop", "--drain", "--all", "--wait", "--timeout", "2"], {
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
    expect(polls).toBe(2)
    expect(stdout.text()).toContain("drained (2 polls)")
  })

  test("#given a claims-only endpoint #when stop refuses #then wait continues until the claim is released", () => {
    const { pluginRoot, agentDir } = fixture()
    const claimed = {
      ...endpoint(join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock"), {
        claimsLive: 1,
        shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" },
        generations: [],
      }),
      reachable: false,
      generations: [],
    }
    let polls = 0
    const engine = scriptedEngine((args) => {
      if (args.includes("--all")) return { exitCode: 3, stdout: JSON.stringify({ endpoints: [claimed] }) }
      if (args[1] === "stop") {
        return { exitCode: 3, stdout: JSON.stringify({ action: "refuse", reason: "unknown_owner" }) }
      }
      polls += 1
      return {
        exitCode: 3,
        stdout: JSON.stringify({ ...claimed, claims_live: polls === 1 ? 1 : 0 }),
      }
    })
    const stdout = capture()
    let clock = 0

    const exitCode = runDaemonCommand(["stop", "--drain", "--all", "--wait", "--timeout", "2"], {
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
    expect(polls).toBe(2)
    expect(stdout.text()).toContain("drained (2 polls)")
  })
})
