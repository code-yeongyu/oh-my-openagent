import { describe, expect, test } from "bun:test"
import { memorySettings } from "./memory.test-support"
import { resolveReflectionTriggerConfig } from "./trigger-wiring"

describe("resolveReflectionTriggerConfig", () => {
  test("#given resolved memory settings #when no agent override applies #then the base trigger config is used", () => {
    expect(resolveReflectionTriggerConfig(memorySettings())).toEqual({ enabled: true, stepCount: 25, onCompaction: true })
    expect(
      resolveReflectionTriggerConfig(
        memorySettings({
          reflection: { enabled: true, trigger: { step_count: 4, on_compaction: false }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
        }),
      ),
    ).toEqual({ enabled: true, stepCount: 4, onCompaction: false })
  })

  test("#given a per-agent override #when the bound agent matches #then its trigger fields win field by field", () => {
    const settings = memorySettings({
      reflection: { enabled: true, trigger: { step_count: 4, on_compaction: false }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
      agents: {
        writer: { reflection: { trigger: { step_count: 9 } } },
        reviewer: { reflection: { trigger: { on_compaction: true } } },
      },
    })

    expect(resolveReflectionTriggerConfig(settings, "writer")).toEqual({ enabled: true, stepCount: 9, onCompaction: false })
    expect(resolveReflectionTriggerConfig(settings, "reviewer")).toEqual({ enabled: true, stepCount: 4, onCompaction: true })
    expect(resolveReflectionTriggerConfig(settings, "unknown-agent")).toEqual({ enabled: true, stepCount: 4, onCompaction: false })
  })

  test("#given reflection disabled in base settings #when no agent override applies #then enabled is false", () => {
    const settings = memorySettings({
      reflection: { enabled: false, trigger: { step_count: 25, on_compaction: true }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
    })

    expect(resolveReflectionTriggerConfig(settings)).toEqual({ enabled: false, stepCount: 25, onCompaction: true })
  })

  test("#given reflection enabled in base but disabled by per-agent override #when the bound agent matches #then enabled is false", () => {
    const settings = memorySettings({
      agents: {
        writer: { reflection: { enabled: false } },
      },
    })

    expect(resolveReflectionTriggerConfig(settings, "writer")).toEqual({ enabled: false, stepCount: 25, onCompaction: true })
    expect(resolveReflectionTriggerConfig(settings, "other-agent")).toEqual({ enabled: true, stepCount: 25, onCompaction: true })
  })

  test("#given reflection disabled in base but enabled by per-agent override #when the bound agent matches #then enabled is true", () => {
    const settings = memorySettings({
      reflection: { enabled: false, trigger: { step_count: 25, on_compaction: true }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
      agents: {
        reviewer: { reflection: { enabled: true } },
      },
    })

    expect(resolveReflectionTriggerConfig(settings, "reviewer")).toEqual({ enabled: true, stepCount: 25, onCompaction: true })
  })
})
