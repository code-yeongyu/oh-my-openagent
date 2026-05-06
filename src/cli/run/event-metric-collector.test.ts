import { describe, expect, test } from "bun:test"
import { createEventMetricCollector } from "./event-metric-collector"
import type { MetricSnapshot } from "./event-metric-collector"
import type { ToolExecuteProps, ToolResultProps } from "./types"

function executeEvent(name: string, input: Record<string, unknown> = {}): ToolExecuteProps {
  return { sessionID: "ses-test", name, input }
}

function resultEvent(name: string, output: string): ToolResultProps {
  return { sessionID: "ses-test", name, output }
}

describe("createEventMetricCollector", () => {
  test("#given mixed delegation and implementation tools #when collecting events #then counts each class", () => {
    const collector = createEventMetricCollector()

    collector.onToolExecute(executeEvent("call_omo_agent", { prompt: "delegate" }))
    collector.onToolResult(resultEvent("call_omo_agent", "Task ID: bg_123"))
    collector.onToolExecute(executeEvent("edit"))
    collector.onToolExecute(executeEvent("read"))

    expect(collector.getSnapshot()).toMatchObject({
      delegationAttempts: 1,
      delegationSuccesses: 1,
      directImplementationAttempts: 1,
      otherToolCalls: 1,
      totalToolCalls: 3,
      eventsAnalyzed: 4,
    })
  })

  test("#given direct implementation only #when collecting events #then records no delegation", () => {
    const collector = createEventMetricCollector()

    collector.onToolExecute(executeEvent("write"))
    collector.onToolExecute(executeEvent("hashline_edit"))

    expect(collector.getSnapshot()).toMatchObject({
      delegationAttempts: 0,
      delegationSuccesses: 0,
      directImplementationAttempts: 2,
      otherToolCalls: 0,
      totalToolCalls: 2,
      eventsAnalyzed: 2,
    })
  })

  test("#given failed delegation result #when collecting result #then does not count success", () => {
    const collector = createEventMetricCollector()

    collector.onToolExecute(executeEvent("call_omo_agent"))
    collector.onToolResult(resultEvent("call_omo_agent", "Error: invalid agent type"))

    expect(collector.getSnapshot()).toMatchObject({
      delegationAttempts: 1,
      delegationSuccesses: 0,
      totalToolCalls: 1,
      eventsAnalyzed: 2,
    })
  })

  test("#given no tool execution timing data #when snapshotting empty collector #then timestamps remain null", () => {
    const collector = createEventMetricCollector()

    const snapshot = collector.getSnapshot()

    expect(snapshot.firstToolTimestamp).toBeNull()
    expect(snapshot.lastToolTimestamp).toBeNull()
  })

  test("#given prompt and model output in events #when snapshotting #then raw text is redacted", () => {
    const collector = createEventMetricCollector()
    const execute = executeEvent("task", { prompt: "SECRET PROMPT", modelOutput: "MODEL TEXT" })
    const beforeExecute = structuredClone(execute)
    const result = resultEvent("task", "MODEL OUTPUT WITH SECRET")
    const beforeResult = structuredClone(result)

    collector.onToolExecute(execute)
    collector.onToolResult(result)
    const snapshot: MetricSnapshot = collector.getSnapshot()
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain("SECRET PROMPT")
    expect(serialized).not.toContain("MODEL OUTPUT")
    expect(execute).toEqual(beforeExecute)
    expect(result).toEqual(beforeResult)
  })
})
