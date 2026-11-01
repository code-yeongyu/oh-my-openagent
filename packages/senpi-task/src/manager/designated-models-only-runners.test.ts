import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { afterEach, describe, expect, test } from "bun:test"

import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { cleanupProjects } from "./__fixtures__/manager-fakes"
import { runCategoryChild as runChild, runCategoryChildren, type DesignatedChildInput } from "./__fixtures__/designated-child"
import { chainIds } from "./__fixtures__/model-chain-ids"
import type { ModelChainWorld } from "./__fixtures__/model-chain-world"

// #12006 / #11781 on every runner: a process child and a host session build their settings from the
// user's settings file, where senpi's own fallback (user chains over the shipped defaults) is on, and
// senpi layers its shipped chains over any chain map, so even a pinned chain's last rung can walk on.
let world: ModelChainWorld | undefined
afterEach(async () => {
  await world?.dispose()
  world = undefined
  cleanupProjects()
})

const runCategoryChild = (input: DesignatedChildInput) => runChild(input, (adopted) => { world = adopted })
const calledModels = (adopted: ModelChainWorld) => adopted.calls.map((call) => call.model)
const modelId = (display: string) => display.slice(display.indexOf("/") + 1)
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

describe.each(["in-process", "process", "host"] as const)("a %s child runs only on its designated models", (runner) => {
  const { primary, second, parent, opus55, opus5 } = chainIds(runner)
  const userChains = { [primary]: [parent, second], [opus55]: [parent, second] }

  test("#given the user's settings chain its only model to the parent's and another model #when that model hits its usage limit #then no other model is called and the task fails typed", async () => {
    // given / when
    const { record, world } = await runCategoryChild({
      runner,
      category: "deep-high",
      chain: [primary],
      scripts: { [primary]: ["quota"] },
      userFallbackChains: userChains,
    })

    // then
    expect(calledModels(world)).toEqual([primary])
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${primary}: usage limit (resets 3:20am)`)
  }, 60_000)

  test("#given a two-model chain and user chains that name other models #when both are refused #then only the two designated models ran, and the shipped default after the second never did", async () => {
    // given / when
    const { record, world } = await runCategoryChild({
      runner,
      category: "deep-high",
      chain: [primary, opus55],
      scripts: { [primary]: ["refusal"], [opus55]: ["refusal"] },
      userFallbackChains: userChains,
    })

    // then
    expect(new Set(calledModels(world))).toEqual(new Set([primary, opus55]))
    expect(calledModels(world)).not.toContain(opus5)
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
  }, 60_000)

  test("#given a two-model chain whose first model is spent #when the second works #then the child completes on the second and calls nothing else", async () => {
    // given / when
    const { record, world } = await runCategoryChild({
      runner,
      category: "unspecified-low",
      chain: [primary, second],
      scripts: { [primary]: ["quota"] },
      userFallbackChains: userChains,
    })

    // then
    expect(record.status).toBe("completed")
    expect(calledModels(world)).toEqual([primary, second])
  }, 60_000)
})

describe.each(["in-process", "process", "host"] as const)("senpi's shipped default chain on a %s child", (runner) => {
  const { opus55, opus5 } = chainIds(runner)

  test("#given no user fallback chains and a child designated only claude-opus-5-5 #when it hits its usage limit #then claude-opus-5 is never called and the task fails typed", async () => {
    // given: claude-opus-5 is served on another account, so only the shipped default could reach it.
    // Precondition: the engine still ships that chain, or this case would pass without proving anything.
    const { SettingsManager } = await loadSenpiBarrel()
    const shipped = SettingsManager.inMemory({}).getRetryFallbackSettings().chains
    expect(shipped[modelId(opus55)]).toContain(`${modelId(opus5)}:max`)
    const { record, world } = await runCategoryChild({ runner, category: "deep-high", chain: [opus55], scripts: { [opus55]: ["quota"] } })

    // then
    expect(calledModels(world)).toEqual([opus55])
    expect(calledModels(world)).not.toContain(opus5)
    expect(record.status).toBe("error")
    expect(record.failure_kind).toBe("model_chain_exhausted")
    expect(record.error_message).toContain(`${opus55}: usage limit (resets 3:20am)`)
  }, 60_000)
})

describe("each child's designated chain on one socket host stays its own session's", () => {
  const { primary, second, parent, opus55, opus5 } = chainIds("host")

  test("#given two children started together on one host with different chains #when every designated model is spent #then each walks only its own chain and the user's settings file is byte-identical", async () => {
    // given: A's chain keeps fallback on and has no opus55 key, so on B's session it would let the shipped
    // default reach opus5; B's turns fallback off, so on A's session A would never reach its second model.
    const scripts = { [primary]: ["quota"], [second]: ["quota"], [opus55]: ["quota"] } as const
    const userFallbackChains = { [primary]: [parent, second], [opus55]: [parent, second] }

    // when
    const { records, world: oneHost } = await runCategoryChildren([
      { runner: "host", category: "unspecified-low", chain: [primary, second], scripts, userFallbackChains },
      { runner: "host", category: "deep-high", chain: [opus55], scripts, userFallbackChains },
    ], (adopted) => { world = adopted })

    // then
    const [a, b] = records
    expect([...calledModels(oneHost)].sort()).toEqual([primary, second, opus55].sort())
    expect(calledModels(oneHost)).not.toContain(opus5)
    expect(a?.failure_kind).toBe("model_chain_exhausted")
    expect(a?.error_message).toContain(`${second}: usage limit (resets 3:20am)`)
    expect(a?.error_message).not.toContain(opus55)
    expect(b?.failure_kind).toBe("model_chain_exhausted")
    expect(b?.error_message).toContain(`${opus55}: usage limit (resets 3:20am)`)
    expect(b?.error_message).not.toContain(second)
    expect(sha256(oneHost.engineSettingsPath("host"))).toBe(sha256(oneHost.settingsPath))
  }, 90_000)
})
