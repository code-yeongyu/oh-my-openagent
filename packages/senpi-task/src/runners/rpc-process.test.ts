import { type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { afterEach, describe, expect, test } from "bun:test"

import type { RpcSpawnDescriptor } from "./rpc/spawn"
import { mapExitOutcomeToError } from "./rpc/exit-mapping"
import { terminateRpcChild } from "./rpc/terminate"
import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"
import { RpcProcessRunner } from "./rpc-process"
import type { RpcRunnerSpec } from "./types"

const isWin32 = process.platform === "win32"
const children: ChildProcess[] = []
const tmpDirs: string[] = []

function makeSpec(overrides: Partial<RpcRunnerSpec> = {}): RpcRunnerSpec {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-rpc-"))
  tmpDirs.push(stateDir)
  return { task_id: "st_deadbeef", cwd: process.cwd(), state_dir: stateDir, prompt: "hello", ...overrides }
}

function makeRunner(extra: { heartbeatIntervalMs?: number } = {}): {
  runner: RpcProcessRunner
  captured: () => RpcSpawnDescriptor | undefined
} {
  let captured: RpcSpawnDescriptor | undefined
  const runner = new RpcProcessRunner({
    ...extra,
    spawnChild: (descriptor) => {
      captured = descriptor
      const child = spawnFakeChild(descriptor.env)
      children.push(child)
      return child
    },
  })
  return { runner, captured: () => captured }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop()
    if (child) {
      await terminateRpcChild(child, { sigkillDelayMs: 200 })
    }
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("RpcProcessRunner", () => {
  test("#given a completing child #when started #then the handle reports final text and a clean exit", async () => {
    // given
    const { runner } = makeRunner()

    // when
    const handle = runner.start(makeSpec({ prompt: "finish:final answer" }))
    await handle.waitForIdle()
    const outcome = await handle.waitForExit()

    // then
    expect(handle.lastAssistantText()).toBe("final answer")
    expect(handle.pid).toBeDefined()
    expect(outcome.kind).toBe("clean")
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: true })).toBeNull()
  })

  test("#given a busy child #when steered #then the steer is acked while the turn is in flight", async () => {
    // given
    const { runner } = makeRunner()
    const handle = runner.start(makeSpec({ prompt: "hold" }))
    const events: AgentSessionEvent[] = []
    handle.subscribe((event) => events.push(event))
    await waitFor(() => events.some((e) => e.type === "agent_start"))

    // when
    await handle.steer("mid-course")

    // then
    await waitFor(() => events.some((e) => e.type === "queue_update"))
    const queued = events.find((e) => e.type === "queue_update")
    expect(queued && "steering" in queued ? queued.steering : []).toContain("mid-course")
  })

  test("#given a busy child #when followUp is sent #then it is routed as a prompt with followUp streaming behavior", async () => {
    // given
    const { runner } = makeRunner()
    const handle = runner.start(makeSpec({ prompt: "hold" }))
    const events: AgentSessionEvent[] = []
    handle.subscribe((event) => events.push(event))
    await waitFor(() => events.some((e) => e.type === "agent_start"))

    // when
    await handle.followUp("later note")

    // then
    await waitFor(() => events.some((e) => e.type === "queue_update" && "followUp" in e && e.followUp.length > 0))
    const queued = events.find((e) => e.type === "queue_update" && "followUp" in e && e.followUp.length > 0)
    expect(queued && "followUp" in queued ? queued.followUp : []).toContain("later note")
  })

  test.skipIf(isWin32)(
    "#given a child killed by signal #when it exits #then the outcome is killed and maps to status error with killed:true",
    async () => {
      // given
      const { runner } = makeRunner()

      // when
      const handle = runner.start(makeSpec({ prompt: "diesignal" }))
      const outcome = await handle.waitForExit()

      // then
      expect(outcome.kind).toBe("killed")
      expect(outcome.facts.signal).toBe("SIGKILL")
      expect(outcome.facts.pid).toBeDefined()
      const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })
      expect(mapped?.status).toBe("error")
      expect(mapped?.killed).toBe(true)
    },
  )

  test("#given a child that exits nonzero before terminal #when it crashes #then the outcome carries the stderr tail", async () => {
    // given
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on("unhandledRejection", onRejection)
    const { runner } = makeRunner()

    // when
    const handle = runner.start(makeSpec({ prompt: "crash:4:boom stderr detail" }))
    const outcome = await handle.waitForExit()
    await new Promise((resolve) => setTimeout(resolve, 30))
    process.off("unhandledRejection", onRejection)

    // then
    expect(outcome.kind).toBe("crashed")
    expect(outcome.facts.code).toBe(4)
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: false })?.error_message).toContain("boom stderr detail")
    expect(rejections).toEqual([])
  })

  test("#given a resident child #when heartbeats poll #then lastSeen and sessionId are recorded", async () => {
    // given
    const { runner } = makeRunner({ heartbeatIntervalMs: 20 })
    const handle = runner.start(makeSpec({ prompt: "hold" }))

    // when
    await waitFor(() => handle.lastSeen() !== undefined)

    // then
    expect(handle.lastSeen()).toBeDefined()
    expect(handle.sessionId).toBe("fake-session")
  })

  test("#given a spawn #when the descriptor is built #then the child gets an isolated session dir, not the real HOME", () => {
    // given
    const { runner, captured } = makeRunner()
    const spec = makeSpec({ prompt: "hold" })

    // when
    const handle = runner.start(spec)
    const descriptor = captured()

    // then
    expect(handle.pid).toBeDefined()
    const sessionDir = descriptor?.env.SENPI_CODING_AGENT_SESSION_DIR ?? ""
    expect(sessionDir.startsWith(join(spec.state_dir, "sessions", spec.task_id))).toBe(true)
    expect(sessionDir.startsWith(join(homedir(), ".senpi"))).toBe(false)
    expect(descriptor?.cwd).toBe(spec.cwd)
  })

  test("#given an idle resident child #when revived with a follow-up #then waitForIdle re-arms for the new turn instead of the consumed first idle", async () => {
    // given a first turn that completed while the child stays resident
    const { runner } = makeRunner()
    const handle = runner.start(makeSpec({ prompt: "first" }))
    await handle.waitForIdle()
    expect(handle.lastAssistantText()).toBe("first")

    // when a follow-up revives the idle child
    await handle.followUp("second")

    // then the already-consumed first idle must NOT satisfy the re-armed waitForIdle
    const nextIdle = handle.waitForIdle()
    const raced = await Promise.race([
      nextIdle.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ])
    expect(raced).toBe("pending")

    // and the re-armed waitForIdle resolves once the new turn actually completes
    await handle.steer("complete")
    await nextIdle
    expect(handle.lastAssistantText()).toBe("steered-complete")
  })

  test("#given inheritedExtensions and a spec without its own extensions #when started #then the child spec carries the inherited entries", () => {
    // given
    let seen: RpcRunnerSpec | undefined
    const runner = new RpcProcessRunner({
      inheritedExtensions: ["/tmp/mock.ts"],
      buildSpawn: (spec) => {
        seen = spec
        return { command: "/bin/true", args: [], cwd: spec.cwd, env: {} }
      },
      spawnChild: (descriptor) => {
        const child = spawnFakeChild(descriptor.env)
        children.push(child)
        return child
      },
    })

    // when
    runner.start(makeSpec())

    // then
    expect(seen?.extensions).toEqual(["/tmp/mock.ts"])
  })

  test("#given a spec that already carries extensions #when started #then inheritedExtensions do NOT override them", () => {
    // given
    let seen: RpcRunnerSpec | undefined
    const runner = new RpcProcessRunner({
      inheritedExtensions: ["/tmp/inherited.ts"],
      buildSpawn: (spec) => {
        seen = spec
        return { command: "/bin/true", args: [], cwd: spec.cwd, env: {} }
      },
      spawnChild: (descriptor) => {
        const child = spawnFakeChild(descriptor.env)
        children.push(child)
        return child
      },
    })

    // when
    runner.start(makeSpec({ extensions: ["/tmp/explicit.ts"] }))

    // then
    expect(seen?.extensions).toEqual(["/tmp/explicit.ts"])
  })
})
