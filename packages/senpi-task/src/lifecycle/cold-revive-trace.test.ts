import type { ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { RpcProcessRunner } from "../runners/rpc-process"
import { createColdReviveTrace } from "./__fixtures__/cold-revive-trace"

const WINDOW_MS = 200
const GAP_MS = 100

describe("cold-revive progress watchdog", () => {
  // Guards the residency test's "never stricter than the product" contract (#10993): the product arms a
  // request's deadline when it writes the request, so the watchdog must not fire before that deadline.
  test("#given a request written after the last stage #when the child stays silent #then the stall is counted from the write", async () => {
    // given a traced child that never answers, and a watchdog armed at its last stage
    const trace = createColdReviveTrace()
    const child = trace.spawnProcess(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "pipe", "pipe"] })
    await once(child, "spawn")
    const progress = trace.watchProgress(WINDOW_MS)
    try {
      // when a request goes out some time after that stage
      await new Promise((resolve) => setTimeout(resolve, GAP_MS))
      const sentAt = performance.now()
      child.stdin?.write(`${JSON.stringify({ type: "get_state", id: "probe" })}\n`)
      const error = await progress.stalled.catch((stall: unknown) => stall)
      const firedAfterSendMs = performance.now() - sentAt

      // then the stall fires a full window after the write and names it
      expect(firedAfterSendMs).toBeGreaterThanOrEqual(WINDOW_MS)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("\"request_sent:get_state (launch 1)\"")
    } finally {
      progress.dispose()
      const closed = once(child, "close")
      child.kill()
      await closed
    }
  })

  test("#given the real heartbeat probing a silent child #when no request is answered #then the stall is counted from the last real stage, not the probes", async () => {
    // given a real runner whose heartbeat probes every 50 ms, spawning a child that never answers
    const root = mkdtempSync(join(tmpdir(), "cold-revive-trace-heartbeat-"))
    const startedAt = performance.now()
    const trace = createColdReviveTrace()
    const children: ChildProcess[] = []
    const runner = new RpcProcessRunner({
      heartbeatIntervalMs: 50,
      modelAdmission: async () => undefined,
      spawnProcess: (command, args, options) => {
        const child = trace.spawnProcess(command, args, options)
        children.push(child)
        return child
      },
      buildSpawn: () => ({ command: process.execPath, args: ["-e", "process.stdin.resume()"], cwd: root, env: { PATH: process.env.PATH } }),
    })
    const progress = trace.watchProgress(WINDOW_MS)
    let started: Promise<unknown> = Promise.resolve()
    try {
      // when the runner sends its first prompt and the heartbeat keeps probing
      started = runner.start({ task_id: "st_heartbeat", cwd: root, state_dir: root, prompt: "work" }).catch((error: unknown) => error)
      const error = await progress.stalled.catch((stall: unknown) => stall)
      const firedAt = performance.now()

      // then probes were written after the last real stage (the prompt goes out before the spawn event),
      // yet the stall names that stage and fires a full window after it
      const spawned = trace.stages.find((stage) => stage.stage === "process_spawned")
      expect(spawned).toBeDefined()
      expect(trace.stages.some((stage) => stage.stage === "request_sent" && stage.facts["command"] === "prompt")).toBe(true)
      expect(trace.stages.some((stage) => stage.stage === "heartbeat_probe" && stage.elapsed_ms > (spawned?.elapsed_ms ?? 0))).toBe(true)
      expect(firedAt - (startedAt + (spawned?.elapsed_ms ?? 0))).toBeGreaterThanOrEqual(WINDOW_MS)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("after \"process_spawned (launch 1)\"")
    } finally {
      progress.dispose()
      for (const child of children) child.kill()
      await started
      rmSync(root, { recursive: true, force: true })
    }
  })
})
