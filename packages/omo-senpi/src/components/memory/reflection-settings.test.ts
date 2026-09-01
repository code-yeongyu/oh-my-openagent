import { describe, expect, test } from "bun:test"

import { memorySettings } from "./memory.test-support"
import { resolveAgentReflectionSettings } from "./reflection-settings"

describe("effective reflection settings", () => {
  test("#given conflicting base and agent fields #when resolved #then every override wins and nested trigger defaults survive", () => {
    // given
    const settings = memorySettings({
      reflection: {
        enabled: true,
        trigger: { step_count: 25, on_compaction: true },
        merge: "auto",
        category: "quick",
        timeout_minutes: 15,
        sandbox: "required",
      },
      agents: {
        "agent-test": {
          reflection: {
            enabled: false,
            trigger: { step_count: 5 },
            merge: "integration",
            category: "deep",
            timeout_minutes: 30,
            sandbox: "off",
          },
        },
      },
    })

    // when
    const resolved = resolveAgentReflectionSettings(settings, "agent-test")

    // then
    expect(resolved).toEqual({
      enabled: false,
      trigger: { step_count: 5, on_compaction: true },
      merge: "integration",
      category: "deep",
      timeout_minutes: 30,
      sandbox: "off",
    })
  })
})
