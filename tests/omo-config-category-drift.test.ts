import { describe, expect, test } from "bun:test"
import { CategoryConfigSchema } from "../packages/omo-opencode/src/config/schema/categories"
import { OmoCategoryConfigObjectSchema } from "../packages/omo-config-core/src/schema/category"

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort()
}

describe("omo config category drift guard", () => {
  test("#given omo category schemas #when comparing zod object shape keys #then omo-config-core matches omo-opencode", () => {
    // given
    // The canonical schema is wrapped in a legacy-key preprocessor, so the drift guard compares
    // the inner object shape that the preprocessor feeds.
    const opencodeKeys = Object.keys(CategoryConfigSchema.shape)
    const omoConfigKeys = Object.keys(OmoCategoryConfigObjectSchema.shape)

    // when
    const opencodeThinkingKeys = Object.keys(CategoryConfigSchema.shape.thinking.unwrap().shape)
    const omoConfigThinkingKeys = Object.keys(OmoCategoryConfigObjectSchema.shape.thinking.unwrap().shape)

    // then
    expect(sorted(omoConfigKeys)).toEqual(sorted(opencodeKeys))
    expect(sorted(omoConfigThinkingKeys)).toEqual(sorted(opencodeThinkingKeys))
  })
})
