import type { ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"
import { terminateRpcChild } from "./rpc/terminate"
import { RpcProcessRunner } from "./rpc-process"
import type { ChildEventListener } from "./types"

type ChildEvent = Parameters<ChildEventListener>[0]

const children: ChildProcess[] = []
const tmpDirs: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) await terminateRpcChild(child, { sigkillDelayMs: 200 })
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runner(): RpcProcessRunner {
  return new RpcProcessRunner({
    spawnChild: (descriptor) => {
      const child = spawnFakeChild({ ...descriptor.env })
      children.push(child)
      return child
    },
  })
}

function spec(taskId: string, prompt: string) {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-rpc-early-"))
  tmpDirs.push(stateDir)
  return { task_id: taskId, cwd: process.cwd(), state_dir: stateDir, prompt }
}

// A process child can run its whole first turn (a tool call and an in-session fallback hop included)
// before `start` returns and the manager subscribes; the task record is built from those events (#9582).
describe("events a process child emits before the manager subscribes", () => {
  test("#given a child that finishes its first turn before start returns #when the manager subscribes #then it still receives that turn's events in order", async () => {
    // given
    const handle = await runner().start(spec("st_e1", "done early"))
    await handle.waitForIdle()

    // when
    const seen: ChildEvent[] = []
    handle.subscribe((event) => void seen.push(event))

    // then
    expect(seen.map((event) => event.type)).toEqual(["agent_start", "message_end", "agent_end", "agent_idle"])
  })

  test("#given two observers attached together #when they subscribe after the early turn #then each receives it once and later events arrive live", async () => {
    // given
    const handle = await runner().start(spec("st_e2", "done early"))
    await handle.waitForIdle()

    // when
    const first: string[] = []
    const second: string[] = []
    handle.subscribe((event) => void first.push(event.type))
    handle.subscribe((event) => void second.push(event.type))
    await Promise.resolve()
    const late: string[] = []
    const queued = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waited 5s for the follow-up's queue_update, never arrived")), 5_000)
      handle.subscribe((event) => {
        late.push(event.type)
        if (event.type === "queue_update") {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    await handle.followUp("again")
    await queued

    // then
    expect(first.slice(0, 4)).toEqual(["agent_start", "message_end", "agent_end", "agent_idle"])
    expect(second.slice(0, 4)).toEqual(first.slice(0, 4))
    expect(late).not.toContain("agent_start")
    expect(late).toContain("queue_update")
    expect(first.filter((type) => type === "agent_start")).toHaveLength(1)
  })

  test("#given a live subscriber #when the child's message_end arrives #then the handle has already recorded it, as on dev (subscribers run after the handle)", async () => {
    // given
    const handle = await runner().start(spec("st_e3", "hold"))
    const atMessageEnd = new Promise<string | undefined>((resolve) => {
      handle.subscribe((event) => {
        if (event.type === "message_end") resolve(handle.lastAssistantText())
      })
    })

    // when
    await handle.steer("complete")

    // then
    expect(await atMessageEnd).toBe("steered-complete")
  })
})
