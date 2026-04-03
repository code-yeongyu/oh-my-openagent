import { describe, expect, test } from "bun:test"

import { isTaskSystemEnabled } from "./task-system-enabled"

describe("isTaskSystemEnabled", () => {
  describe("#given experimental.task_system is omitted", () => {
    test("#when resolving #then it defaults to false", () => {
      // given
      const config = {}

      // when
      const result = isTaskSystemEnabled(config)

      // then
      expect(result).toBe(false)
    })
  })

  describe("#given experimental.task_system is enabled", () => {
    test("#when resolving #then it returns true", () => {
      // given
      const config = { experimental: { task_system: true } }

      // when
      const result = isTaskSystemEnabled(config)

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given experimental.task_system is disabled", () => {
    test("#when resolving #then it returns false", () => {
      // given
      const config = { experimental: { task_system: false } }

      // when
      const result = isTaskSystemEnabled(config)

      // then
      expect(result).toBe(false)
    })
  })
})
