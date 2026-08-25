import { describe, expect, test } from "bun:test"

import type { ReservedRun } from "@oh-my-opencode/memory-core"

import { fireDream } from "./dream-trigger-fire"
import { NOW_MS, fixture, triggerSettings } from "./dream-trigger.test-support"

describe("pressure dream origin", () => {
  test("#given no unreflected transcripts #when pressure fires past spacing #then it attempts one reservation through the shared store", async () => {
    const reservations: ReservedRun["request"][] = []
    const run: ReservedRun = {
      runId: "run-pressure",
      request: {
        trigger: "dream",
        origin: "pressure",
        conversationIds: [],
        snapshots: [],
      },
    }
    const f = await fixture({
      conversationText: null,
      reservationStore: {
        tryReserve: async (request) => {
          reservations.push(request)
          return { status: "active", run }
        },
      },
    })

    const outcome = await fireDream({
      session: f.session,
      origin: "pressure",
      settings: triggerSettings(),
      request: {},
      now: () => NOW_MS,
      warnLaunchFailure: () => {},
    })

    expect(outcome).toEqual({ fired: true, runId: "run-pressure", status: "active" })
    expect(reservations).toEqual([{
      trigger: "dream",
      origin: "pressure",
      conversationIds: [],
      snapshots: [],
    }])
    expect(f.launches).toEqual([run])
  })
})
