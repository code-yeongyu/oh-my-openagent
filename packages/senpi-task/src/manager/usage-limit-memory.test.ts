import { describe, expect, test } from "bun:test"

import { createTaskRecord, type ResolvedModelRecord } from "../state"
import { runtimeFallbackCandidates } from "./credential-failure"
import { createUsageLimitMemory, LIMIT_MEMORY_DEFAULT_MS, LIMIT_PROBE_FAILURE_MEMORY_MS } from "./usage-limit-memory"

const WEEKLY = (reset?: string): string =>
  `{"type":"error","error":{"type":"rate_limit_error","message":"Weekly usage limit reached.${reset === undefined ? "" : ` Resets at ${reset}.`}"}}`
const T0 = Date.parse("2026-10-26T05:00:00Z")

function clock() {
  let now = T0
  return { now: () => now, at: (ms: number) => { now = ms } }
}

const rung = (provider: string, modelId: string): ResolvedModelRecord => ({ source: "category", provider, model_id: modelId, display: `${provider}/${modelId}` })

describe("createUsageLimitMemory (#11383)", () => {
  test("an expired stated reset never creates a new memory window", () => {
    const memory = createUsageLimitMemory(clock().now)
    memory.settle("expired", "anthropic", "opus", "Account usage limit reached. Resets at 2026-10-26T04:00:00Z")
    expect(memory.accountSpent("anthropic")).toBe(false)
  })

  test.each(["500: upstream overloaded", "socket hang up", "request timed out"])("a failed probe has exactly thirty minutes of routing memory: %s", (message) => {
    expect(LIMIT_PROBE_FAILURE_MEMORY_MS).toBe(30 * 60_000)
    const time = clock()
    const memory = createUsageLimitMemory(time.now)
    memory.beginProbe("failed", "anthropic", WEEKLY("2026-10-29T04:27:07Z"))
    memory.settle("failed", "anthropic", "opus", message)
    time.at(T0 + 30 * 60_000 - 1)
    expect(memory.accountSpent("anthropic")).toBe(true)
    time.at(T0 + 30 * 60_000)
    expect(memory.accountSpent("anthropic")).toBe(false)
  })

  test("a synthetic timeout does not inherit the original limit reset embedded in its message", () => {
    const time = clock()
    const memory = createUsageLimitMemory(time.now)
    memory.beginProbe("timeout", "anthropic", WEEKLY("2026-10-29T04:27:07Z"))
    memory.settle("timeout", "anthropic", "opus", WEEKLY("2026-10-29T04:27:07Z"), true)
    time.at(T0 + LIMIT_PROBE_FAILURE_MEMORY_MS)
    expect(memory.accountSpent("anthropic")).toBe(false)
  })

  test("#given a probe rung that hits the limit too #when the stated reset passes #then the account is spent until exactly that reset", () => {
    // given
    const time = clock()
    const memory = createUsageLimitMemory(time.now)
    memory.beginProbe("t1", "anthropic", WEEKLY("2026-10-29T04:27:07Z"))

    // when
    memory.settle("t1", "anthropic", "claude-opus-5-5", WEEKLY("2026-10-29T04:27:07Z"))

    // then
    time.at(Date.parse("2026-10-29T04:27:06Z"))
    expect(memory.accountSpent("anthropic")).toBe(true)
    time.at(Date.parse("2026-10-29T04:27:08Z"))
    expect(memory.accountSpent("anthropic")).toBe(false)
  })

  test("#given a confirmed limit that states no reset #when the default window passes #then the account is forgotten", () => {
    // given
    const time = clock()
    const memory = createUsageLimitMemory(time.now)
    memory.beginProbe("t1", "anthropic", WEEKLY())
    memory.settle("t1", "anthropic", "claude-opus-5-5", WEEKLY())

    // then
    time.at(T0 + LIMIT_MEMORY_DEFAULT_MS - 1)
    expect(memory.accountSpent("anthropic")).toBe(true)
    time.at(T0 + LIMIT_MEMORY_DEFAULT_MS + 1)
    expect(memory.accountSpent("anthropic")).toBe(false)
  })

  test.each([
    ["an ordinary provider error", "500: upstream overloaded"],
    ["a dropped connection", "socket hang up"],
  ])("#given a probe rung that fails with %s #when it settles #then the provider's account counts as spent", (_label, failure) => {
    // given
    const memory = createUsageLimitMemory(clock().now)
    memory.beginProbe("t1", "anthropic", WEEKLY("2026-10-29T04:27:07Z"))

    // when
    memory.settle("t1", "anthropic", "claude-opus-5-5", failure)

    // then
    expect(memory.accountSpent("anthropic")).toBe(true)
  })

  test("#given one family's ambiguous limit #when a later child's walk reaches the same family #then that rung is skipped and the provider's other family stays", () => {
    // given
    const memory = createUsageLimitMemory(clock().now)
    memory.settle("t1", "anthropic", "claude-fable-5-1", WEEKLY("2026-10-29T04:27:07Z"))
    const later = createTaskRecord({
      parent_session_id: "session-parent",
      root_session_id: "session-root",
      depth: 1,
      execution_mode: "in-process",
      notify_on_terminal: false,
      model: "anthropic/claude-sonnet-5-5",
      resolved_model: rung("anthropic", "claude-sonnet-5-5"),
      fallback_models: [rung("anthropic", "claude-fable-5"), rung("anthropic", "claude-opus-5-5"), rung("zai", "glm-5.3")],
    })

    // when
    const candidates = runtimeFallbackCandidates(later, "500: upstream overloaded", memory)

    // then
    expect(candidates.remaining).toEqual([rung("anthropic", "claude-opus-5-5"), rung("zai", "glm-5.3")])
    expect(candidates.skipped).toEqual([rung("anthropic", "claude-fable-5")])
    expect(memory.accountSpent("anthropic")).toBe(false)
  })
})
