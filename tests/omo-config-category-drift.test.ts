import { describe, expect, test } from "bun:test"
import { CategoryConfigBaseSchema } from "../packages/omo-opencode/src/config/schema/categories"
import { BaseCategoryConfigSchema } from "../packages/omo-config-core/src/schema/category"

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort()
}

describe("omo config category drift guard", () => {
  test("#given omo category schemas #when comparing zod object shape keys #then omo-config-core matches omo-opencode", () => {
    // given
    const opencodeKeys = Object.keys(CategoryConfigBaseSchema.shape)
    const omoConfigKeys = Object.keys(BaseCategoryConfigSchema.shape)

    // when
    const opencodeThinkingKeys = Object.keys(CategoryConfigBaseSchema.shape.thinking.unwrap().shape)
    const omoConfigThinkingKeys = Object.keys(BaseCategoryConfigSchema.shape.thinking.unwrap().shape)

    // then
    expect(sorted(omoConfigKeys)).toEqual(sorted(opencodeKeys))
    expect(sorted(omoConfigThinkingKeys)).toEqual(sorted(opencodeThinkingKeys))
  })
})
