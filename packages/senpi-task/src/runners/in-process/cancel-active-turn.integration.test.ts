import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { runFixtureScript } from "./__fixtures__/bounded-run"

// omo#15191: a workflow cancel used to leave an in-process child's active turn running to its end (the
// record read cancelled meanwhile), because the engine once left a rejection floating when an active
// session was aborted or disposed. Each case runs the real engine in its own process, so this also
// fails if a later engine floats a rejection again. Both processes start together in the setup hook;
// each test reads its own case's result.

const CANCEL_RUN = join(import.meta.dir, "__fixtures__", "cancel-run.ts")
const RUN_BOUND_MS = 90_000

async function cancelRun(turn: "holds" | "runs-a-tool"): Promise<unknown> {
  const run = await runFixtureScript(CANCEL_RUN, turn, RUN_BOUND_MS)
  if (run.exit !== 0) throw new Error(`cancel run ${turn} did not exit cleanly (${run.exit}): ${run.stderr}`)
  return JSON.parse(run.stdout)
}

const runs: { holds?: unknown; runsATool?: unknown } = {}

describe("a cancel with the abort skipped interrupts a real in-process child's active turn (#15191)", () => {
  beforeAll(async () => {
    const [holds, runsATool] = await Promise.all([cancelRun("holds"), cancelRun("runs-a-tool")])
    runs.holds = holds
    runs.runsATool = runsATool
  }, RUN_BOUND_MS + 30_000)

  test("#given a child whose provider reply is still open #when it is cancelled as a workflow cancel does #then the request is aborted, the turn ends cancelled, the session is destroyed in that call and nothing floats", () => {
    // then - the setup hook ran this case in its own process
    expect(runs.holds).toEqual({
      cancel: "cancelled",
      destroyed: ["cancel"],
      turn: "cancelled",
      record: "cancelled",
      residency: "disposed",
      providerCallsAfterCancel: 0,
      providerAborted: true,
      floating: [],
    })
  })

  test("#given a child whose tool call is still running #when it is cancelled as a workflow cancel does #then the tool is stopped through its signal, no further provider call is made and nothing floats", () => {
    // then - the setup hook ran this case in its own process
    expect(runs.runsATool).toEqual({
      cancel: "cancelled",
      destroyed: ["cancel"],
      turn: "cancelled",
      record: "cancelled",
      residency: "disposed",
      providerCallsAfterCancel: 0,
      tool: "stopped by its signal",
      floating: [],
    })
  })
})
