import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects } from "./__fixtures__/manager-fakes"
import { PARENT, runCategoryChild as runChild, type DesignatedChildInput } from "./__fixtures__/designated-child"
import { ALT, CLAUDE, COUNT_TOOL, type ModelChainWorld } from "./__fixtures__/model-chain-world"

const PRIMARY = `${CLAUDE}/primary`
const SECOND = `${ALT}/rung`

let world: ModelChainWorld | undefined
afterEach(async () => {
  await world?.dispose()
  world = undefined
  cleanupProjects()
})

const runCategoryChild = (input: DesignatedChildInput) => runChild(input, (adopted) => { world = adopted })

describe("a child runs only on its designated models, never on the parent's model", () => {
  test.each([
    ["unspecified-high", "quota", "usage limit (resets 3:20am)"],
    ["unspecified-high", "refusal", "refused"],
    ["unspecified-high", "auth", "not signed in"],
    ["deep-high", "quota", "usage limit (resets 3:20am)"],
    ["deep-low", "refusal", "refused"],
    ["quick", "auth", "not signed in"],
  ] as const)("#given a %s child whose only model fails with %s #when the chain is exhausted #then the parent model is never called and the task fails typed naming the model and why", async (category, step, why) => {
    // given / when
    const { record, world } = await runCategoryChild({ category, chain: [PRIMARY], scripts: { [PRIMARY]: [step] } })

    // then
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY])
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${PRIMARY}: ${why}`)
    expect("parent_model" in record).toBe(false)
  }, 30_000)

  test.each(["quota", "refusal", "auth"] as const)("#given a two-model chain where both fail with %s #when the chain is exhausted #then both designated models ran, the parent never did, and the failure lists each", async (step) => {
    // given / when
    const { record, world } = await runCategoryChild({
      category: "deep-high",
      chain: [PRIMARY, SECOND],
      scripts: { [PRIMARY]: [step], [SECOND]: [step] },
    })

    // then
    expect(world.calls.map((call) => call.model)).not.toContain(PARENT)
    expect(new Set(world.calls.map((call) => call.model))).toEqual(new Set([PRIMARY, SECOND]))
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${PRIMARY}: `)
    expect(record.error_message).toContain(`${SECOND}: `)
  }, 30_000)

  test("#given the only designated model ran a tool and then hit its usage limit #when the turn fails #then the tool ran once, the parent was never called, and the task fails typed", async () => {
    // given / when
    const { record, world } = await runCategoryChild({ category: "deep-high", chain: [PRIMARY], scripts: { [PRIMARY]: [{ tool: COUNT_TOOL }, "quota"] } })

    // then
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, PRIMARY])
    expect(world.toolRuns()).toBe(1)
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${PRIMARY}: usage limit (resets 3:20am)`)
  }, 30_000)

  test("#given a designated second model that works #when the first hits its usage limit #then the child completes on the second, never on the parent", async () => {
    // given / when
    const { record, world } = await runCategoryChild({ category: "unspecified-low", chain: [PRIMARY, SECOND], scripts: { [PRIMARY]: ["quota"] } })

    // then
    expect(record.status).toBe("completed")
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, SECOND])
  }, 30_000)
})
