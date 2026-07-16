import { describe, expect, test } from "bun:test"

import type { ToolsRecord } from "./plugin/types"
import { createPluginInterface } from "./plugin-interface"

const BACKGROUND_WAIT_TAG = "[CRITICAL — BACKGROUND TASKS RUNNING]"

function createBackgroundWaitPlugin(tools: ToolsRecord) {
  return createPluginInterface({
    ctx: { directory: "/tmp", client: {} } as never,
    pluginConfig: { experimental: { block_on_background_tasks: true } } as never,
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {
      backgroundManager: {
        hasActiveChildTasks: () => false,
        hasActiveDescendantTasks: () => true,
        hasPendingParentWake: () => false,
      },
    } as never,
    hooks: {} as never,
    tools,
  })
}

describe("createPluginInterface - effective background wait availability", () => {
  test("does not inject a mandatory reminder when final tool filtering removed the wait tool", async () => {
    // given
    const pluginInterface = createBackgroundWaitPlugin({})
    const output = { system: [] as string[] }

    // when
    await pluginInterface["experimental.chat.system.transform"]?.(
      { sessionID: "main-1", model: { id: "anthropic/claude-opus-4-8", providerID: "anthropic" } },
      output,
    )

    // then
    expect(output.system.some((part) => part.includes(BACKGROUND_WAIT_TAG))).toBe(false)
  })

  test("allows legacy sleep when only nested work is active and final filtering removed the wait tool", async () => {
    // given
    const pluginInterface = createBackgroundWaitPlugin({})
    const output = { args: { command: "sleep 1" } }

    // when
    const run = pluginInterface["tool.execute.before"]?.(
      { tool: "bash", sessionID: "main-1", callID: "call-sleep" },
      output,
    )

    // then
    await expect(run).resolves.toBeUndefined()
  })

  test("blocks sleep for nested work when the final registry exposes the wait tool", async () => {
    // given
    const pluginInterface = createBackgroundWaitPlugin({ "wait-for-background-tasks": {} as never })
    const output = { args: { command: "sleep 1" } }

    // when
    const run = pluginInterface["tool.execute.before"]?.(
      { tool: "bash", sessionID: "main-1", callID: "call-sleep" },
      output,
    )

    // then
    await expect(run).rejects.toThrow("Background task wait is already managed")
  })
})
