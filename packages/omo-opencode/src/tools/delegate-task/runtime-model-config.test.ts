import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig } from "../../config"
import * as providerCache from "../../shared/connected-providers-cache"
import * as executor from "./executor"
import type { DelegateTaskToolOptions } from "./types"
import { createDelegateTask } from "./tools"

type ModelConfig = Pick<OhMyOpenCodeConfig, "agents" | "categories">
type LaunchInput = Parameters<DelegateTaskToolOptions["manager"]["launch"]>[0]
const context = { sessionID: "ses_parent", messageID: "msg_parent", agent: "sisyphus", abort: new AbortController().signal }

function setup() {
  spyOn(executor, "resolveParentContext").mockResolvedValue({ sessionID: "ses_parent", messageID: "msg_parent", agent: "sisyphus" })
  spyOn(providerCache, "readProviderModelsCache").mockReturnValue({
    connected: ["fixture"],
    models: { fixture: ["startup", "expensive", "cheap", "explicit", "default", "fallback"] },
    updatedAt: new Date().toISOString(),
  })
  const launched: LaunchInput[] = []
  const resume = mock(async () => ({ id: "bg_existing", sessionId: "ses_existing", agent: "sisyphus-junior", status: "running", description: "continue" }))
  const manager = {
    launch: async (input: LaunchInput) => {
      launched.push(input)
      return { id: `bg_${launched.length}`, sessionId: `ses_${launched.length}`, agent: input.agent, status: "running", description: input.description }
    },
    getTask: () => undefined,
    resume,
  }
  let current: ModelConfig = { agents: { "sisyphus-junior": { model: "fixture/expensive" } }, categories: { runtime: { description: "Runtime test" } } }
  const load = mock(() => current)
  const task = createDelegateTask({
    manager: unsafeTestValue(manager),
    client: unsafeTestValue({ config: { get: async () => ({ data: { model: "fixture/default" } }) } }),
    directory: "/tmp",
    sisyphusJuniorModel: "fixture/startup",
    agentOverrides: { "sisyphus-junior": { model: "fixture/startup" } },
    userCategories: { runtime: { description: "Runtime test" } },
    loadCurrentModelConfig: load,
  })
  const dispatch = () => task.execute({ description: "Runtime config", prompt: "Check the current config", category: "runtime", load_skills: [], run_in_background: true }, unsafeTestValue(context))
  return { task, launched, load, resume, dispatch, update: (value: ModelConfig) => { current = value } }
}

afterEach(() => { mock.restore() })

describe("task runtime model config", () => {
  test("refreshes the junior default per dispatch, honors category precedence and forgets deleted defaults", async () => {
    const fixture = setup()
    await fixture.dispatch()
    fixture.update({ agents: { "sisyphus-junior": { model: "fixture/cheap" } }, categories: { runtime: { description: "Runtime test" } } })
    await fixture.dispatch()
    fixture.update({ agents: { "sisyphus-junior": { model: "fixture/cheap" } }, categories: { runtime: { model: "fixture/explicit", variant: "low", fallback_models: ["fixture/fallback"] } } })
    await fixture.dispatch()
    fixture.update({ categories: { runtime: { description: "Runtime test" } } })
    await fixture.dispatch()
    expect(fixture.launched.map((input) => input.model?.modelID)).toEqual(["expensive", "cheap", "explicit", "default"])
    expect(fixture.launched[2]?.model?.variant).toBe("low")
    expect(fixture.launched[2]?.fallbackChain?.[0]?.model).toBe("fallback")
    expect(fixture.launched[0]?.model?.modelID).toBe("expensive")
    expect(fixture.load).toHaveBeenCalledTimes(4)
  })

  test("a new dispatch cannot replace an in-flight dispatch's captured model and fallback", async () => {
    const fixture = setup()
    fixture.update({ categories: { runtime: { model: "fixture/expensive", variant: "high", fallback_models: ["fixture/fallback"] } } })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const resolve = executor.resolveCategoryExecution
    let first = true
    spyOn(executor, "resolveCategoryExecution").mockImplementation(async (...args) => {
      if (first) {
        first = false
        entered.resolve()
        await release.promise
      }
      return resolve(...args)
    })
    const pending = fixture.dispatch()
    await entered.promise
    try {
      fixture.update({ categories: { runtime: { model: "fixture/cheap", variant: "low" } } })
      await fixture.dispatch()
    } finally {
      release.resolve()
    }
    await pending
    expect(fixture.launched.map((input) => input.model?.modelID)).toEqual(["cheap", "expensive"])
    expect(fixture.launched[0]?.model?.variant).toBe("low")
    expect(fixture.launched[1]?.model?.variant).toBe("high")
    expect(fixture.launched[1]?.fallbackChain?.[0]?.model).toBe("fallback")
    expect(fixture.load).toHaveBeenCalledTimes(2)
  })

  test.each([true, false])("continuation skips model config loading (background=%s)", async (background) => {
    const fixture = setup()
    const continuation = background ? "executeBackgroundContinuation" : "executeSyncContinuation"
    const continued = spyOn(executor, continuation).mockResolvedValue("continued")
    const result = await fixture.task.execute({ description: "continue", prompt: "Continue", task_id: "ses_existing", load_skills: [], run_in_background: background }, unsafeTestValue(context))
    expect(result).toBe("continued")
    expect(fixture.load).not.toHaveBeenCalled()
    expect(continued).toHaveBeenCalledTimes(1)
    expect(fixture.launched).toHaveLength(0)
  })
})
