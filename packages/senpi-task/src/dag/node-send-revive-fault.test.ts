// Once the task manager has revived a child, the send never gives the lease back: the revive watcher is
// armed before any fallible write and owns the lease's end. If the send's own journal write fails, the
// send still rejects with that error, the lease stays while the child runs, and when the child settles
// the watcher releases it (the node never became running, so there is nothing to fold) (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { sendRun, THIS_HOST, type Leased } from "./__fixtures__/send-run"
import type { DagFileStore } from "./store"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG revive whose journal write fails after the child was revived", () => {
  test("#given the task manager revived the child #when the send's journal write fails #then the send rejects, the lease stays while the child runs, and the watcher releases it once the child settles", async () => {
    // given - the revive's first journal write fails once; checkpoint writes report a released lease
    let failed = false
    let markReleased = (): void => undefined
    const released = new Promise<void>((resolve) => (markReleased = resolve))
    const run = sendRun(cleanupRoots, ["a", "b"], {
      wrap: (base): DagFileStore => ({
        ...base,
        appendEvent: (event) => {
          if (!failed && event.type === "dag.node.steered") {
            failed = true
            throw new Error("disk I/O failure")
          }
          return base.appendEvent(event)
        },
        writeCheckpoint: (id, checkpoint) => {
          base.writeCheckpoint(id, checkpoint)
          if (failed && (checkpoint as Leased).leaseHolderPid === undefined) markReleased()
        },
      }),
    })

    // when
    const refusal = await run.refusalOf(() => run.send("a"))

    // then - the error reaches the caller, and the run stays this host's while the child runs
    expect(refusal).toEqual(expect.objectContaining({ message: "disk I/O failure" }))
    expect(run.manager.get("task-a")?.status).toBe("running")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    expect(await run.refusalOf(() => run.otherRetry("b"))).toEqual(expect.objectContaining({ code: "run_not_owned" }))

    // and when the child settles, the watcher gives the lease back and writes nothing else
    run.manager.complete("task-a")
    await released
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.nodeState("a")).toBe("failed")
    expect(run.read()?.nodes.some((entry) => entry.state === "running" || entry.state === "scheduled")).toBe(false)
    expect((await run.otherRetry("b").run).status).toBe("failed")
  })
})
