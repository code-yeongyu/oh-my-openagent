import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects } from "./__fixtures__/manager-fakes"
import { runCategoryChild as runChild, type DesignatedChildInput, PARENT } from "./__fixtures__/designated-child"
import { CLAUDE, type ModelChainWorld, type Step } from "./__fixtures__/model-chain-world"

const RUNGS = [`${CLAUDE}/primary`, `${CLAUDE}/sibling`, `${CLAUDE}/claude-opus-5-5`] as const
// Every call to any rung stays limited, so a retry is a recorded call instead of a scripted success.
const ALWAYS = 20

let world: ModelChainWorld | undefined
afterEach(async () => {
  await world?.dispose()
  world = undefined
  cleanupProjects()
})

const runCategoryChild = (input: DesignatedChildInput) => runChild(input, (adopted) => { world = adopted })
const limited = (step: Step) => Object.fromEntries(RUNGS.map((model) => [model, Array<Step>(ALWAYS).fill(step)]))

describe("a one-provider category chain whose every rung is usage-limited (omo#9711)", () => {
  test.each(["quota", "weekly"] as const)("#given every rung fails with a %s limit #when the chain is spent #then the child fails once, typed model_chain_exhausted naming each model and why, with no retry loop", async (step) => {
    // given / when
    const { record, world: settled } = await runCategoryChild({ category: "ultrabrain", chain: RUNGS, scripts: limited(step) })

    // then - one typed terminal result that names the provider's models and their reason
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    for (const model of RUNGS) expect(record.error_message).toMatch(new RegExp(`${model}: .*limit`, "i"))
    expect(record.error_message?.split(`${RUNGS[0]}: `)).toHaveLength(2)

    // then - each rung was dispatched at most once and never the parent: a spent chain is not retried
    const models = settled.calls.map((call) => call.model)
    expect(models).not.toContain(PARENT)
    for (const model of RUNGS) expect(models.filter((called) => called === model).length).toBeLessThanOrEqual(1)
  }, 30_000)
})
