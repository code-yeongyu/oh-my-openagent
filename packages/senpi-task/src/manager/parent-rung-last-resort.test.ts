import { describe, expect, test } from "bun:test"

import { childRetryFallbackProfile } from "../runners/retry-fallback-profile"
import { modelSelector } from "../runners/in-process/runtime-fallback-settings"
import type { RpcRunnerSpec } from "../runners/types"
import type { ResolvedModelRecord } from "../state"
import { withParentModelRung } from "./parent-model-rung"
import { createRpcManagedRunner } from "./runner"
import type { ManagedStartSpec, ManagerStartSpec, ResolvedChildPlan } from "./types"

const rung = (provider: string, id: string): ResolvedModelRecord => ({ source: "category", provider, model_id: id, display: `${provider}/${id}` })

const PRIMARY = rung("vendor-a", "one")
const SIBLING = rung("vendor-b", "two")
const PLAN: ResolvedChildPlan = { model: PRIMARY.display, requested_model: PRIMARY, resolved_model: PRIMARY, fallback_models: [SIBLING] }
const SPEC = { prompt: "work", parent_session_id: "p", depth: 1, category: "quick", parent_model: "parent-co/parent" } satisfies ManagerStartSpec

describe("the parent session's rung is a last resort in the engine chain (#11781)", () => {
  test("#given a category child whose parent runs another model #when the parent rung is appended #then it serializes with the last-resort flag and the category rungs do not", () => {
    // when
    const routed = withParentModelRung(PLAN, SPEC)

    // then
    expect((routed.plan.fallback_models ?? []).map(modelSelector)).toEqual(["vendor-b/two", "parent-co/parent!last-resort"])
  })

  test("#given a process child with the parent rung #when the runner starts it #then the chain senpi receives keeps the flag on that rung only", async () => {
    // given
    const routed = withParentModelRung(PLAN, SPEC)
    let started: RpcRunnerSpec | undefined
    const runner = createRpcManagedRunner({
      start: async (spec) => {
        started = spec
        throw new Error("start captured")
      },
    })
    const spec: ManagedStartSpec = {
      taskId: "t1", cwd: "/work", stateDir: "/state/tasks/t1", prompt: "work", depth: 1, parentSessionId: "p", rootSessionId: "p",
      model: PRIMARY.display, fallbackModels: routed.plan.fallback_models,
    }

    // when
    await runner.start(spec).catch(() => undefined)

    // then
    expect(started === undefined ? undefined : childRetryFallbackProfile(started)).toEqual({
      modelFallback: true,
      fallbackChains: { [PRIMARY.display]: ["vendor-b/two", "parent-co/parent!last-resort"] },
    })
  })

  test("#given a rung with a thinking level #when it is the parent rung #then the flag follows the level", () => {
    // given
    const parent: ResolvedModelRecord = { ...rung("parent-co", "parent"), reasoning: "high", last_resort: true }

    // when
    const selector = modelSelector(parent)

    // then
    expect(selector).toBe("parent-co/parent:high!last-resort")
  })
})
