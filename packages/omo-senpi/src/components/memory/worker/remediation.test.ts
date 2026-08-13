import { describe, expect, test } from "bun:test"

import { reflectionRemediation } from "./remediation"

describe("reflectionRemediation", () => {
  test("#given an ENOENT naming a path #when advising #then it names that path instead of blaming the senpi executable", () => {
    // given the failure a missing sandbox write grant produces
    const detail = "ENOENT: no such file or directory, lstat '/Users/ivan/.omo/memory/agents/para-8ba08a5b/runtime/reflection-sessions'"

    // when
    const advice = reflectionRemediation("spawn_failed", detail)

    // then
    expect(advice).toContain("/Users/ivan/.omo/memory/agents/para-8ba08a5b/runtime/reflection-sessions")
    expect(advice).not.toContain("SENPI_BIN")
  })

  test("#given a spawn failure with no path #when advising #then the executable hint still stands", () => {
    // given
    const detail = "spawn senpi ENOENT"

    // when
    const advice = reflectionRemediation("spawn_failed", detail)

    // then
    expect(advice).toContain("SENPI_BIN")
  })

  test("#given a model visibility failure #when advising #then the category hint wins over the path hint", () => {
    // given
    const advice = reflectionRemediation("model_not_visible", "model not found")

    // then
    expect(advice).toContain("memory.reflection")
  })
})
