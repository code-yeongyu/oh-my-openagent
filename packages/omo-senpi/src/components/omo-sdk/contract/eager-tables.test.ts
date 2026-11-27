import { describe, expect, test } from "bun:test"

import { ROOT_CALL_ANSWERS } from "./call-answers"
import { ROOT_CALLS } from "./calls"
import { inputAccepts } from "./validate"

// The root builds without evaluating the call table or the thread core (they load on first use), so a schema that cannot
// be built would only fail at a call. This test builds them all eagerly, so it fails in CI instead.
describe("the tables the root loads on first use", () => {
  test("#given the answer table the root assembles from #then it names exactly the call table's calls, each with its kind", () => {
    expect(Object.keys(ROOT_CALL_ANSWERS).toSorted()).toEqual(Object.keys(ROOT_CALLS).toSorted())
    expect(
      Object.entries(ROOT_CALLS).filter(
        ([key, call]) => ROOT_CALL_ANSWERS[key as keyof typeof ROOT_CALL_ANSWERS] !== call.answer,
      ),
    ).toEqual([])
  })

  test("#given every call's input schema and the thread core's modules #when they are built #then each loads and checks an input", async () => {
    expect(Object.keys(ROOT_CALLS).filter((key) => typeof inputAccepts(key, {}) !== "boolean")).toEqual([])
    const [contracts, core] = await Promise.all([import("../../thread/contracts"), import("../../thread/sdk-core")])
    expect(Object.keys(contracts.threadToolParamSchemas).length).toBeGreaterThan(0)
    expect(typeof core.createThreadCore).toBe("function")
  })
})
