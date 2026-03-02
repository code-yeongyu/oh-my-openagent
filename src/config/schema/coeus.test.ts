import { describe, expect, test } from "bun:test"
import { CoeusConfigSchema } from "./coeus"

describe("CoeusConfigSchema", () => {
  test("should accept valid config with all fields", () => {
    // given
    const config = {
      enabled: true,
      max_depth: 2,
      max_sub_planners: 5,
      cost_budget_tokens: 100000,
      decomposition_strategy: "hybrid",
      sub_plan_storage_path: ".sisyphus/sub-plans",
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
      expect(result.data.max_depth).toBe(2)
      expect(result.data.max_sub_planners).toBe(5)
      expect(result.data.cost_budget_tokens).toBe(100000)
      expect(result.data.decomposition_strategy).toBe("hybrid")
      expect(result.data.sub_plan_storage_path).toBe(".sisyphus/sub-plans")
    }
  })

  test("should use defaults when fields omitted", () => {
    // given
    const config = {}

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
      expect(result.data.max_depth).toBe(1)
      expect(result.data.max_sub_planners).toBe(5)
      expect(result.data.decomposition_strategy).toBe("auto")
      expect(result.data.sub_plan_storage_path).toBe(".sisyphus/sub-plans")
    }
  })

  test("should reject max_depth < 1", () => {
    // given
    const config = {
      max_depth: 0,
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should reject max_depth > 3", () => {
    // given
    const config = {
      max_depth: 4,
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should reject max_sub_planners < 1", () => {
    // given
    const config = {
      max_sub_planners: 0,
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should reject max_sub_planners > 10", () => {
    // given
    const config = {
      max_sub_planners: 11,
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept valid decomposition_strategy values", () => {
    // given
    const strategies = ["auto", "domain", "feature", "hybrid"]

    // when/then
    for (const strategy of strategies) {
      const result = CoeusConfigSchema.safeParse({
        decomposition_strategy: strategy,
      })
      expect(result.success).toBe(true)
    }
  })

  test("should reject invalid decomposition_strategy", () => {
    // given
    const config = {
      decomposition_strategy: "invalid",
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept optional cost_budget_tokens", () => {
    // given
    const config = {
      cost_budget_tokens: 50000,
    }

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cost_budget_tokens).toBe(50000)
    }
  })

  test("should allow cost_budget_tokens to be undefined", () => {
    // given
    const config = {}

    // when
    const result = CoeusConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cost_budget_tokens).toBeUndefined()
    }
  })
})
