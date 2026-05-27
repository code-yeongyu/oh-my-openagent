import { describe, test, expect } from "bun:test"
import { isTaskSystemEnabled, type TaskSystemConfig } from "./task-system-enabled"

describe("isTaskSystemEnabled", () => {
  describe("#given config with experimental.task_system enabled", () => {
    test("#when task_system is true #then returns true", () => {
      const config: TaskSystemConfig = {
        experimental: {
          task_system: true,
        },
      }
      expect(isTaskSystemEnabled(config)).toBe(true)
    })
  })

  describe("#given config with experimental.task_system disabled", () => {
    test("#when task_system is false #then returns false", () => {
      const config: TaskSystemConfig = {
        experimental: {
          task_system: false,
        },
      }
      expect(isTaskSystemEnabled(config)).toBe(false)
    })
  })

  describe("#given config with missing experimental property", () => {
    test("#when experimental is undefined #then returns false", () => {
      const config: TaskSystemConfig = {}
      expect(isTaskSystemEnabled(config)).toBe(false)
    })
  })

  describe("#given config with experimental but missing task_system", () => {
    test("#when task_system is undefined #then returns false", () => {
      const config: TaskSystemConfig = {
        experimental: {},
      }
      expect(isTaskSystemEnabled(config)).toBe(false)
    })
  })
})
