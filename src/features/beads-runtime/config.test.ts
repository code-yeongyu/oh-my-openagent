import { describe, expect, test } from "bun:test"

import {
  assertBeadsRuntimeCanActivate,
  BEADS_RUNTIME_TASK_SYSTEM_COLLISION_MESSAGE,
  getBeadsRuntimeActivationState,
  isBeadsRuntimeEnabled,
} from "./config"

describe("beads runtime config gate", () => {
  test("returns disabled when beads runtime flag is omitted", () => {
    expect(isBeadsRuntimeEnabled({})).toBe(false)
    expect(getBeadsRuntimeActivationState({})).toEqual({ enabled: false })
  })

  test("returns enabled when beads runtime is true and task system is false", () => {
    const config = {
      experimental: {
        beads_runtime: true,
        task_system: false,
      },
    }

    expect(isBeadsRuntimeEnabled(config)).toBe(true)
    expect(getBeadsRuntimeActivationState(config)).toEqual({ enabled: true })
    expect(() => assertBeadsRuntimeCanActivate(config)).not.toThrow()
  })

  test("fails closed with a deterministic diagnostic when both runtime flags are true", () => {
    const config = {
      experimental: {
        beads_runtime: true,
        task_system: true,
      },
    }

    expect(getBeadsRuntimeActivationState(config)).toEqual({
      enabled: false,
      error: BEADS_RUNTIME_TASK_SYSTEM_COLLISION_MESSAGE,
    })
    expect(() => assertBeadsRuntimeCanActivate(config)).toThrow(
      BEADS_RUNTIME_TASK_SYSTEM_COLLISION_MESSAGE,
    )
  })
})
