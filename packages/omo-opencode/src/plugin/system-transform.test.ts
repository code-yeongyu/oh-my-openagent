/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import type { BackgroundManager } from "../features/background-agent"
import { createSystemTransformHandler } from "./system-transform"

const WAIT_TAG = "[CRITICAL — BACKGROUND TASKS RUNNING]"

function backgroundManager(hasActive: boolean): Pick<BackgroundManager, "hasActiveChildTasks"> {
  return { hasActiveChildTasks: () => hasActive }
}

function runHandler(
  options: Parameters<typeof createSystemTransformHandler>[2],
  input: { sessionID?: string },
): Promise<string[]> {
  const handler = createSystemTransformHandler(undefined, undefined, options)
  const output = { system: [] as string[] }
  return handler(
    { sessionID: input.sessionID, model: { id: "anthropic/claude-opus-4-8", providerID: "anthropic" } },
    output,
  ).then(() => output.system)
}

describe("createSystemTransformHandler background-wait injection", () => {
  test("does not inject when block_on_background_tasks is off", async () => {
    // #given the flag off but active tasks present
    const options = { backgroundManager: backgroundManager(true), blockOnBackgroundTasks: false }

    // #when the handler runs
    const system = await runHandler(options, { sessionID: "main-1" })

    // #then no wait reminder is injected
    expect(system.some((part) => part.includes(WAIT_TAG))).toBe(false)
  })

  test("injects the wait reminder when the flag is on and the session has active tasks", async () => {
    // #given the flag on and active tasks
    const options = { backgroundManager: backgroundManager(true), blockOnBackgroundTasks: true }

    // #when the handler runs
    const system = await runHandler(options, { sessionID: "main-1" })

    // #then the wait reminder is injected
    expect(system.some((part) => part.includes(WAIT_TAG))).toBe(true)
    expect(system.some((part) => part.includes("wait-for-background-tasks"))).toBe(true)
    expect(system.some((part) => part.includes("times out"))).toBe(true)
    expect(system.some((part) => part.includes("aborted"))).toBe(true)
  })

  test("does not inject when the flag is on but the session has no active tasks", async () => {
    // #given the flag on but no active tasks
    const options = { backgroundManager: backgroundManager(false), blockOnBackgroundTasks: true }

    // #when the handler runs
    const system = await runHandler(options, { sessionID: "main-1" })

    // #then no wait reminder is injected
    expect(system.some((part) => part.includes(WAIT_TAG))).toBe(false)
  })

  test("does not duplicate the wait reminder when it is already present", async () => {
    // #given the flag on, active tasks, and the reminder already in the system prompt
    const options = { backgroundManager: backgroundManager(true), blockOnBackgroundTasks: true }
    const handler = createSystemTransformHandler(undefined, undefined, options)
    const output = { system: [`<system-reminder>\n${WAIT_TAG}\nalready here</system-reminder>`] }

    // #when the handler runs
    await handler(
      { sessionID: "main-1", model: { id: "anthropic/claude-opus-4-8", providerID: "anthropic" } },
      output,
    )

    // #then only the pre-existing entry remains
    const matches = output.system.filter((part) => part.includes(WAIT_TAG))
    expect(matches.length).toBe(1)
  })
})
