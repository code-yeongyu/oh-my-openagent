import { describe, expect, test } from "bun:test"

import type { StartResult, TaskManager } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

const IDS = ["st_rib_1", "st_rib_2"] as const

type ManagerProbe = {
  readonly manager: TaskManager
  starts(): number
  waits(): number
}

function textOf(result: Awaited<ReturnType<ReturnType<typeof buildTaskExecute>>>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}

// Counts spawns and foreground waits. A wait THROWS instead of pending so a wrongly-synchronous
// batch fails fast with a named reason rather than hanging the test on a never-resolving promise.
function probeManager(): ManagerProbe {
  let starts = 0
  let waits = 0
  const manager = createFakeManager({
    start: async (): Promise<StartResult> => {
      const taskId = IDS[starts]
      if (taskId === undefined) throw new Error("unexpected extra start")
      starts += 1
      return { kind: "started", task_id: taskId, status: "running", name: `item-${starts}` }
    },
    waitFor: () => {
      waits += 1
      throw new Error("foreground wait must not run for a background batch")
    },
  })
  return { manager, starts: () => starts, waits: () => waits }
}

describe("task batch run_in_background resolution", () => {
  test("#given every item sets run_in_background true and no top-level flag #when the batch executes #then it returns immediately as a background batch", async () => {
    // given
    const probe = probeManager()

    // when
    const output = await buildTaskExecute(makeDeps(probe.manager))(
      "batch-item-background",
      {
        category: "quick",
        tasks: [
          { prompt: "review one", run_in_background: true },
          { prompt: "review two", run_in_background: true },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(probe.starts()).toBe(2)
    expect(probe.waits()).toBe(0)
    expect(output.details).toMatchObject({ task_id: IDS[0], status: "running", run_in_background: true })
    expect(textOf(output)).toContain("Batch running.")
  })

  test("#given a top-level false and one item true #when the batch executes #then it fails typed before any child starts", async () => {
    // given
    const probe = probeManager()

    // when
    const output = await buildTaskExecute(makeDeps(probe.manager))(
      "batch-conflict-top-level",
      {
        category: "quick",
        run_in_background: false,
        tasks: [
          { prompt: "review one", run_in_background: true },
          { prompt: "review two" },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(probe.starts()).toBe(0)
    expect(output.details.status).toBe("invalid_arguments")
    expect(textOf(output)).toContain("run_in_background is batch-wide")
    expect(textOf(output)).toContain("top-level=false")
    expect(textOf(output)).toContain("tasks[0]=true")
  })

  test("#given items that disagree with each other #when the batch executes #then it fails typed and names both values", async () => {
    // given
    const probe = probeManager()

    // when
    const output = await buildTaskExecute(makeDeps(probe.manager))(
      "batch-conflict-items",
      {
        category: "quick",
        tasks: [
          { prompt: "review one", run_in_background: true },
          { prompt: "review two", run_in_background: false },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(probe.starts()).toBe(0)
    expect(output.details.status).toBe("invalid_arguments")
    expect(textOf(output)).toContain("tasks[0]=true")
    expect(textOf(output)).toContain("tasks[1]=false")
  })

  test("#given a top-level true mirrored on one item #when the batch executes #then agreement stays a background batch", async () => {
    // given
    const probe = probeManager()

    // when
    const output = await buildTaskExecute(makeDeps(probe.manager))(
      "batch-agreeing-flags",
      {
        category: "quick",
        run_in_background: true,
        tasks: [
          { prompt: "review one", run_in_background: true },
          { prompt: "review two" },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(probe.starts()).toBe(2)
    expect(probe.waits()).toBe(0)
    expect(output.details.run_in_background).toBe(true)
  })
})
