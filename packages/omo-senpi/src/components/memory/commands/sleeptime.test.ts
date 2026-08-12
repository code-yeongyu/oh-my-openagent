import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { TEST_IDENTITY, fakeCommandContext, fakeDeps, invoke, tempIdentity } from "./commands.test-support"
import { registerSleeptimeCommand, resolveSleeptimeSettings } from "./sleeptime"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("/sleeptime", () => {
  test("#given default settings #when resolved and invoked #then machine values use their defaults without override flags", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const settings = memorySettings()
    const pi = new MemoryFakeExtensionAPI()
    registerSleeptimeCommand(pi, fakeDeps(identity, { loadSettings: () => ({ settings, configPath: "/tmp/omo.jsonc" }) }))
    const ctx = fakeCommandContext()

    // when
    const resolved = resolveSleeptimeSettings(settings, TEST_IDENTITY)
    const text = await invoke(pi, "sleeptime", "", ctx)

    // then
    expect(resolved).toEqual({
      reflection: {
        enabled: { value: true, overridden: false },
        stepCount: { value: 25, overridden: false },
        onCompaction: { value: true, overridden: false },
        merge: { value: "auto", overridden: false },
        category: { value: "quick", overridden: false },
        timeoutMinutes: { value: 15, overridden: false },
        sandbox: { value: "auto", overridden: false },
      },
      nudge: {
        enabled: { value: true, overridden: false },
        everyUserTurns: { value: 10, overridden: false },
      },
      facts: {
        enabled: { value: true, overridden: false },
        debounceSettles: { value: 4, overridden: false },
      },
      dream: {
        enabled: { value: true, overridden: false },
        idleMinutes: { value: 30, overridden: false },
        minHoursBetween: { value: 24, overridden: false },
        shutdownLaunch: { value: true, overridden: false },
        autoSelectMax: { value: 5, overridden: false },
        autoSelectMaxChars: { value: 150000, overridden: false },
      },
      people: {
        enabled: { value: true, overridden: false },
        maxEntries: { value: 40, overridden: false },
        maxEntryChars: { value: 200, overridden: false },
      },
      soul: { editNotice: { value: true, overridden: false } },
    })
    expect(text).toContain("Reflection: on")
    expect(text).toContain("Dream select chars: max 150000 chars")
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "info" }])
  })

  test("#given per-agent overrides #when resolved and invoked #then override values and flags win field by field", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const settings = memorySettings({
      agents: {
        [TEST_IDENTITY]: {
          reflection: {
            enabled: false,
            trigger: { step_count: 5, on_compaction: false },
            merge: "integration",
            category: "deep",
            timeout_minutes: 30,
            sandbox: "required",
          },
          nudge: { enabled: false, every_user_turns: 20 },
          facts: { enabled: false, debounce_settles: 8 },
          dream: {
            enabled: false,
            idle_minutes: 60,
            min_hours_between: 48,
            shutdown_launch: false,
            auto_select_max: 3,
            auto_select_max_chars: 25000,
          },
          people: { enabled: false, max_entries: 20, max_entry_chars: 100 },
          soul: { edit_notice: false },
        },
      },
    })
    const pi = new MemoryFakeExtensionAPI()
    registerSleeptimeCommand(pi, fakeDeps(identity, { loadSettings: () => ({ settings, configPath: "/tmp/omo.jsonc" }) }))
    const ctx = fakeCommandContext()

    // when
    const resolved = resolveSleeptimeSettings(settings, TEST_IDENTITY)
    const text = await invoke(pi, "sleeptime", "", ctx)

    // then
    expect(resolved).toEqual({
      reflection: {
        enabled: { value: false, overridden: true },
        stepCount: { value: 5, overridden: true },
        onCompaction: { value: false, overridden: true },
        merge: { value: "integration", overridden: true },
        category: { value: "deep", overridden: true },
        timeoutMinutes: { value: 30, overridden: true },
        sandbox: { value: "required", overridden: true },
      },
      nudge: {
        enabled: { value: false, overridden: true },
        everyUserTurns: { value: 20, overridden: true },
      },
      facts: {
        enabled: { value: false, overridden: true },
        debounceSettles: { value: 8, overridden: true },
      },
      dream: {
        enabled: { value: false, overridden: true },
        idleMinutes: { value: 60, overridden: true },
        minHoursBetween: { value: 48, overridden: true },
        shutdownLaunch: { value: false, overridden: true },
        autoSelectMax: { value: 3, overridden: true },
        autoSelectMaxChars: { value: 25000, overridden: true },
      },
      people: {
        enabled: { value: false, overridden: true },
        maxEntries: { value: 20, overridden: true },
        maxEntryChars: { value: 100, overridden: true },
      },
      soul: { editNotice: { value: false, overridden: true } },
    })
    for (const line of [
      "Reflection: off [agent override]",
      "On compaction: off [agent override]",
      "Category: deep [agent override]",
      "Sandbox: required [agent override]",
      "Dream shutdown: shutdown launch off [agent override]",
      "Dream select: select max 3 [agent override]",
      "Dream select chars: max 25000 chars [agent override]",
    ]) {
      expect(text).toContain(line)
    }
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "info" }])
  })

  test("#given an unbound session #when invoked #then the command surfaces a structured error notification", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerSleeptimeCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "sleeptime", "", ctx)

    // then
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "error" }])
  })
})
