import { describe, expect, test } from "bun:test"

import { buildResumeArgv, isValidResumeArg, resolveHerdrAgentName } from "./resume"

describe("resolveHerdrAgentName", () => {
  test("#given OMO_NATIVE=1 #then the agent is omo; otherwise senpi", () => {
    expect(resolveHerdrAgentName({ OMO_NATIVE: "1" })).toBe("omo")
    expect(resolveHerdrAgentName({ OMO_NATIVE: "0" })).toBe("senpi")
    expect(resolveHerdrAgentName({})).toBe("senpi")
  })
})

describe("buildResumeArgv", () => {
  test("#given a session id #then it builds `<bin> --session <id>`", () => {
    expect(buildResumeArgv("omo", "sess-1")).toEqual(["omo", "--session", "sess-1"])
  })

  test("#given a model and thinking level #then the model selector rides along", () => {
    expect(
      buildResumeArgv("omo", "sess-1", { provider: "anthropic", id: "claude-opus-5" }, "high"),
    ).toEqual(["omo", "--session", "sess-1", "--model", "anthropic/claude-opus-5:high"])
    expect(buildResumeArgv("omo", "sess-1", { id: "claude-opus-5" })).toEqual([
      "omo", "--session", "sess-1", "--model", "claude-opus-5",
    ])
    expect(buildResumeArgv("omo", "sess-1", { provider: "anthropic", id: "m" }, "off")).toEqual([
      "omo", "--session", "sess-1", "--model", "anthropic/m",
    ])
  })

  test("#given a missing model id #then --model is omitted", () => {
    expect(buildResumeArgv("omo", "sess-1", {})).toEqual(["omo", "--session", "sess-1"])
    expect(buildResumeArgv("omo", "sess-1", { provider: "anthropic" })).toEqual(["omo", "--session", "sess-1"])
  })

  test("#given invalid args #then the whole command is refused", () => {
    expect(buildResumeArgv("o'mo", "sess-1")).toBeUndefined()
    expect(buildResumeArgv("omo", "sess\n1")).toBeUndefined()
    expect(buildResumeArgv("omo", "")).toBeUndefined()
    // > 8 KiB total is refused.
    expect(buildResumeArgv("omo", "x".repeat(9 * 1024))).toBeUndefined()
  })

  test("#given an invalid model arg #then only that arg is dropped", () => {
    expect(buildResumeArgv("omo", "sess-1", { id: "we'ird" })).toEqual(["omo", "--session", "sess-1"])
  })
})

describe("isValidResumeArg", () => {
  test("#given control chars or apostrophes #then rejected", () => {
    expect(isValidResumeArg("plain")).toBe(true)
    expect(isValidResumeArg("")).toBe(false)
    expect(isValidResumeArg("it's")).toBe(false)
    expect(isValidResumeArg("a\tb")).toBe(false)
    expect(isValidResumeArg("a\x7fb")).toBe(false)
  })
})
