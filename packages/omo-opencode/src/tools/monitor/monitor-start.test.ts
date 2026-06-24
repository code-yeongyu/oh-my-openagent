import { describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"

import type { MonitorManager, MonitorRecord, MonitorStartOpts } from "../../features/monitor/types"
import type { BashPermissionAskInput } from "../../features/monitor/permission"
import type { OhMyOpenCodeConfig } from "../../config/schema/oh-my-opencode-config"
import type { PluginContext } from "../../plugin/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createMonitorStart } from "./monitor-start"

type PermissionAsk = (input: BashPermissionAskInput) => Promise<void>

function createRecord(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: "mon_test",
    command: "bun test",
    label: "unit tests",
    mode: "idle",
    parentSessionId: "ses_parent",
    startedAt: new Date(0),
    status: "running",
    counters: {
      totalLines: 0,
      matchedLines: 0,
      unmatchedLines: 0,
      droppedMatched: 0,
      droppedUnmatched: 0,
      bytesDropped: 0,
      lastSequence: 0,
    },
    ...overrides,
  }
}

function createPluginConfig(monitor: Partial<NonNullable<OhMyOpenCodeConfig["monitor"]>> = {}): OhMyOpenCodeConfig {
  return unsafeTestValue<OhMyOpenCodeConfig>({
    monitor: {
      enabled: true,
      live_mode_enabled: true,
      max_monitors_per_session: 3,
      max_runtime_ms: 1800000,
      batch_max_lines: 50,
      batch_max_bytes: 16384,
      flush_interval_ms: 1000,
      ring_max_lines: 1000,
      line_max_bytes: 8192,
      pattern_max_length: 512,
      ...monitor,
    },
  })
}

function createToolContext(ask?: PermissionAsk): ToolContext {
  return unsafeTestValue<ToolContext>({
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    directory: "/repo",
    worktree: "/repo",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: ask ?? (async () => {}),
  })
}

function createHarness(startResult: MonitorRecord = createRecord()) {
  const startCalls: MonitorStartOpts[] = []
  const start = mock(async (opts: MonitorStartOpts) => {
    startCalls.push(opts)
    return startResult
  })
  const manager = unsafeTestValue<MonitorManager>({ start })
  const pluginContext = unsafeTestValue<PluginContext>({})

  return { manager, pluginContext, start, startCalls }
}

describe("createMonitorStart", () => {
  describe("#given Bash-equivalent permission denies the command", () => {
    test("#when monitor_start executes #then it returns the denial reason without spawning", async () => {
      // given
      const { manager, pluginContext, start } = createHarness()
      const ask = mock(async () => {
        throw new Error("blocked by bash policy")
      })
      const tool = createMonitorStart(manager, createPluginConfig(), pluginContext)

      // when
      const result = await tool.execute(
        { command: "bun test", label: "unit tests" },
        createToolContext(ask),
      )

      // then
      expect(start).not.toHaveBeenCalled()
      expect(result).toContain("blocked by bash policy")
    })
  })

  describe('#given match_pattern is invalid regex "["', () => {
    test("#when monitor_start executes #then it returns validation error without spawning", async () => {
      // given
      const { manager, pluginContext, start } = createHarness()
      const ask = mock(async () => {})
      const tool = createMonitorStart(manager, createPluginConfig(), pluginContext)

      // when
      const result = await tool.execute(
        { command: "bun test", label: "unit tests", match_pattern: "[" },
        createToolContext(ask),
      )

      // then
      expect(start).not.toHaveBeenCalled()
      expect(result).toContain("invalid regex")
    })
  })

  describe("#given permission allows the command", () => {
    test("#when monitor_start executes #then it starts once with parent context and returns stop instructions", async () => {
      // given
      const command = "bun test SECRET_TOKEN=redacted"
      const { manager, pluginContext, start, startCalls } = createHarness(
        createRecord({
          id: "mon_allowed",
          command,
          label: "unit tests",
          mode: "live_safe",
        }),
      )
      const ask = mock(async () => {})
      const tool = createMonitorStart(manager, createPluginConfig(), pluginContext)

      // when
      const result = await tool.execute(
        { command, label: "unit tests", mode: "live_safe", match_pattern: "ERROR|FAIL" },
        createToolContext(ask),
      )

      // then
      expect(start).toHaveBeenCalledTimes(1)
      expect(startCalls[0]).toEqual({
        command,
        label: "unit tests",
        mode: "live_safe",
        matchPattern: "ERROR|FAIL",
        parentSessionId: "ses_parent",
        parentMessageId: "msg_parent",
      })
      expect(result).toContain("monitor_id: mon_allowed")
      expect(result).toContain("label: unit tests")
      expect(result).toContain("mode: live_safe")
      expect(result).toContain('monitor_stop with monitor_id="mon_allowed"')
      expect(result).toContain("output arrives automatically")
      expect(result).toContain("do not poll")
      expect(result).not.toContain(command)
    })
  })

  describe("#given live_safe is disabled in config", () => {
    test('#when mode is live_safe #then it starts in idle mode and explains the coercion', async () => {
      // given
      const { manager, pluginContext, startCalls } = createHarness(createRecord({ mode: "idle" }))
      const ask = mock(async () => {})
      const tool = createMonitorStart(
        manager,
        createPluginConfig({ live_mode_enabled: false }),
        pluginContext,
      )

      // when
      const result = await tool.execute(
        { command: "bun test", label: "unit tests", mode: "live_safe" },
        createToolContext(ask),
      )

      // then
      expect(startCalls[0]?.mode).toBe("idle")
      expect(result).toContain("mode: idle")
      expect(result).toContain('requested mode "live_safe" was coerced to "idle"')
    })
  })
})
