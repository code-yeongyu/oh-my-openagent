import { describe, expect, test } from "bun:test"

import { composeStatusLine, formatStatusTarget, taskIdentityLabel } from "./status-line"

describe("taskIdentityLabel", () => {
  test("#given a task summary #when labelled #then the delegated-work summary wins over description, name and id", () => {
    // given / when / then
    expect(
      taskIdentityLabel({
        taskId: "st_00000001",
        name: "task-1",
        description: "quick label",
        taskSummary: "Refactor auth into sessions",
      }),
    ).toBe("Refactor auth into sessions")
  })

  test("#given a blank task summary #when labelled #then it falls back to the description", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", description: "Audit renderers", taskSummary: "  " })).toBe("Audit renderers")
  })

  test("#given a description #when labelled #then the human description wins over name and id", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", name: "task-1", description: "Audit renderers" })).toBe("Audit renderers")
  })

  test("#given no description #when labelled #then the stable name is used", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", name: "reviewer" })).toBe("reviewer")
  })

  test("#given neither description nor name #when labelled #then the id remains as the last-resort handle", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001" })).toBe("st_00000001")
  })

  test("#given blank labels #when labelled #then whitespace-only values are ignored", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", name: "  ", description: "\n" })).toBe("st_00000001")
  })

  test("#given an overlong description #when labelled #then it is excerpted for one status row", () => {
    // given a description far wider than a status row
    const label = taskIdentityLabel({ taskId: "st_00000001", description: "x".repeat(80) })

    // then
    expect(label.length).toBeLessThanOrEqual(48)
    expect(label.endsWith("...")).toBe(true)
  })
})

describe("formatStatusTarget", () => {
  test("#given a category and resolved model #when formatted #then model metadata qualifies the category", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "quick",
        resolvedModel: {
          provider: "chatgpt-subscription",
          model_id: "gpt-5.6-luna-fast",
          display: "gpt-5.6-luna-fast",
          reasoning_effort: "high",
          source: "category",
        },
      }),
    ).toBe("category:quick(chatgpt-subscription/gpt-5.6-luna-fast:high)")
  })

  test("#given only an agent type #when formatted #then the agent target shares the category grammar", () => {
    // given / when / then
    expect(formatStatusTarget({ agentType: "plan-reviewer" })).toBe("agent:plan-reviewer")
  })

  test("#given an agent type and resolved model #when formatted #then model metadata qualifies the agent exactly like a category", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        agentType: "plan-reviewer",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol-fast",
          display: "gpt-5.6-sol-fast",
          reasoning: "high",
          source: "agent",
        },
      }),
    ).toBe("agent:plan-reviewer(openai/gpt-5.6-sol-fast:high)")
  })

  test("#given an agent type with only a raw model #when formatted #then the raw model qualifies the agent target", () => {
    // given / when / then
    expect(formatStatusTarget({ agentType: "explore", model: "anthropic/claude-sonnet-4-6" })).toBe(
      "agent:explore(anthropic/claude-sonnet-4-6)",
    )
  })

  // A record carrying BOTH identities is a task whose caller wrote a subagent_type that a category
  // ended up resolving (#8348). The category must never silently erase the name the caller wrote:
  // the model and the target that selected it have to travel together in the same view.
  test("#given a record carrying both the asked-for agent and the resolving category #when formatted #then both targets ride the model", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "architect",
        agentType: "architect",
        resolvedModel: {
          provider: "anthropic",
          model_id: "claude-fable-5-1",
          display: "claude-fable-5-1",
          reasoning: "xhigh",
          source: "category",
        },
      }),
    ).toBe("agent:architect\u2192category:architect(anthropic/claude-fable-5-1:xhigh)")
  })

  test("#given a record whose asked-for agent differs from the resolving category #when formatted #then the asked-for name is kept", () => {
    // given / when / then
    expect(formatStatusTarget({ category: "visual-engineering", agentType: "frontend-worker" })).toBe(
      "agent:frontend-worker\u2192category:visual-engineering",
    )
  })


  test("#given resolved model metadata with effort and variant #when formatted #then reasoning effort wins in the status target", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "ultrabrain",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT-5.6 Sol",
          reasoning_effort: "xhigh",
          variant: "sol",
          source: "category",
        },
      }),
    ).toBe("category:ultrabrain(openai/gpt-5.6-sol:xhigh)")
  })

  test("#given resolved model metadata with variant only #when formatted #then the variant is rendered", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "ultrabrain",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT-5.6 Sol",
          variant: "sol",
          source: "category",
        },
      }),
    ).toBe("category:ultrabrain(openai/gpt-5.6-sol:sol)")
  })

  test("#given resolved model metadata with reasoning effort only #when formatted #then the reasoning effort is rendered", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "ultrabrain",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT-5.6 Sol",
          reasoning_effort: "xhigh",
          source: "category",
        },
      }),
    ).toBe("category:ultrabrain(openai/gpt-5.6-sol:xhigh)")
  })

  test("#given resolved model metadata without effort or variant #when formatted #then the model name is rendered without a suffix", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "ultrabrain",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT-5.6 Sol",
          source: "category",
        },
      }),
    ).toBe("category:ultrabrain(openai/gpt-5.6-sol)")
  })
  test("#given model metadata with terminal controls #when formatted #then every part is normalized", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "quick",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT\u001b]0;hidden\u0007-5.6 Sol",
          reasoning_effort: "xhigh\u0007",
          variant: "sol\u007f",
          source: "category",
        },
      }),
    ).toBe("category:quick(openai/gpt-5.6-sol:xhigh)")
  })

  test("#given a category but only a raw model #when formatted #then the sanitized raw model qualifies the target", () => {
    // given / when / then
    expect(formatStatusTarget({ category: "quick", model: "anthropic/claude-sonnet-4-5" })).toBe(
      "category:quick(anthropic/claude-sonnet-4-5)",
    )
    expect(formatStatusTarget({ model: "anthropic/claude-sonnet-4-5" })).toBe("model:anthropic/claude-sonnet-4-5")
    expect(formatStatusTarget({ category: "quick", model: "raw\u001b[31m-model" })).toBe("category:quick(raw-model)")
  })

  test("#given no target facts #when formatted #then nothing is emitted", () => {
    // given / when / then
    expect(formatStatusTarget({})).toBeUndefined()
  })
})

describe("composeStatusLine", () => {
  test("#given full live facts #when composed #then tokens follow the canonical identity-first grammar", () => {
    // given / when
    const line = composeStatusLine({
      identity: "Audit renderers",
      target: "quick (kimi-coding/kimi-k3:max)",
      stats: { runtime_ms: 1_000, turns: 3, tool_calls: 7, tokens_per_second: 62 },
      verb: "running read src/foo.ts",
    })

    // then
    expect(line).toBe("Audit renderers · quick (kimi-coding/kimi-k3:max) · turn 3 (7 tools) · running read src/foo.ts · 62 tok/s")
  })

  test("#given cost and cache facts #when composed #then only cost sits immediately before tps", () => {
    // given / when
    const line = composeStatusLine({
      identity: "Audit renderers",
      target: "quick (kimi-coding/kimi-k3:max)",
      stats: {
        runtime_ms: 1_000,
        turns: 3,
        tool_calls: 7,
        tokens_per_second: 62,
        cost_usd: 0.4213,
        cache_hit_rate_last: 0.8712,
        cache_hit_rate_run: 0.4,
      },
      verb: "running read src/foo.ts",
    })

    // then
    expect(line).toBe(
      "Audit renderers · quick (kimi-coding/kimi-k3:max) · turn 3 (7 tools) · running read src/foo.ts · $0.4213 · 62 tok/s",
    )
  })

  test("#given a cache hit rate without cost #when composed #then no spend token renders", () => {
    // given / when / then
    expect(
      composeStatusLine({
        identity: "t",
        stats: { runtime_ms: 0, turns: 1, tool_calls: 0, tokens_per_second: 8, cache_hit_rate_last: 0.5, cache_hit_rate_run: 0.1 },
      }),
    ).toBe("t · turn 1 · 8 tok/s")
  })

  test("#given a single tool call #when composed #then the tool noun is singular", () => {
    // given / when / then
    expect(
      composeStatusLine({ identity: "t", stats: { runtime_ms: 0, turns: 1, tool_calls: 1 }, verb: "running" }),
    ).toBe("t · turn 1 (1 tool) · running")
  })

  test("#given no stats #when composed #then only known tokens are emitted", () => {
    // given / when / then
    expect(composeStatusLine({ identity: "t", verb: "waiting (running)" })).toBe("t · waiting (running)")
  })
})

describe("composeStatusLine not-yet-started grammar", () => {
  test("#given zero stats #when composed #then the row reads starting with no turn or cost token", () => {
    // given / when
    const line = composeStatusLine({
      identity: "Audit renderers",
      target: "category:deep-low(provider/model:medium)",
      stats: { runtime_ms: 41_000, turns: 0, tool_calls: 0, failed_turns: 0 },
      verb: "starting",
    })

    // then — a run that has not landed a turn claims neither motion nor spend
    expect(line).toBe("Audit renderers · category:deep-low(provider/model:medium) · starting")
  })

  test("#given failed attempts without a successful turn #when composed #then the failed counter replaces the turn and cost tokens", () => {
    // given / when
    const line = composeStatusLine({
      identity: "Audit renderers",
      target: "category:deep-low(provider/model:medium)",
      stats: { runtime_ms: 41_000, turns: 0, tool_calls: 0, failed_turns: 2 },
      verb: "retrying",
    })

    // then
    expect(line).toBe("Audit renderers · category:deep-low(provider/model:medium) · failed 2 · retrying")
  })

  test("#given a normal run #when composed #then the turn, tool, cost and tps tokens render exactly as today", () => {
    // given / when
    const line = composeStatusLine({
      identity: "Audit renderers",
      stats: { runtime_ms: 65_000, turns: 3, tool_calls: 5, cost_usd: 0.12, tokens_per_second: 42 },
      verb: "running",
    })

    // then
    expect(line).toBe("Audit renderers · turn 3 (5 tools) · running · $0.1200 · 42 tok/s")
  })

  test("#given a successful turn with a genuine zero cost #when composed #then the cost token still reports the zero", () => {
    // given / when / then
    expect(
      composeStatusLine({ identity: "t", stats: { runtime_ms: 0, turns: 1, tool_calls: 0, cost_usd: 0 }, verb: "running" }),
    ).toBe("t · turn 1 · running · $0.0000")
  })

  test("#given a mix of successful and failed turns #when composed #then both counters ride the row", () => {
    // given / when / then
    expect(
      composeStatusLine({
        identity: "t",
        stats: { runtime_ms: 0, turns: 2, tool_calls: 4, failed_turns: 1, cost_usd: 0.12 },
        verb: "running",
      }),
    ).toBe("t · turn 2 (4 tools) · failed 1 · running · $0.1200")
  })
})
