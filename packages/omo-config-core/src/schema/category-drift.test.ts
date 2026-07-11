import { describe, expect, test } from "bun:test"
import * as z from "zod"
import { OmoCategoryConfigSchema } from "./category"
import { CategoryConfigSchema } from "../../../omo-opencode/src/config/schema/categories"

/**
 * Drift guard: ensures omo-config-core's category schema input keys stay in
 * sync with omo-opencode's CategoryConfigBaseSchema input keys.
 *
 * When you add/remove a field in either schema, this test will fail,
 * prompting you to update both packages together.
 */
describe("omo config category drift guard", () => {
  test("#given omo category schemas #when comparing zod object shape keys #then omo-config-core matches omo-opencode", () => {
    // Extract the input shape from OmoCategoryConfigSchema (ZodEffects wrapping a ZodObject.extend)
    // The inner schema before .transform() is the extended ZodObject
    const omoCoreInner = (OmoCategoryConfigSchema as unknown as z.ZodEffects<z.ZodObject<z.ZodRawShape>>)._def.schema
    const omoCoreKeys = new Set(Object.keys(omoCoreInner.shape))

    // Extract the input shape from CategoryConfigSchema (omo-opencode)
    const omoOpenCodeInner = (CategoryConfigSchema as unknown as z.ZodEffects<z.ZodObject<z.ZodRawShape>>)._def.schema
    const omoOpenCodeKeys = new Set(Object.keys(omoOpenCodeInner.shape))

    const onlyInCore = [...omoCoreKeys].filter((k) => !omoOpenCodeKeys.has(k))
    const onlyInOpenCode = [...omoOpenCodeKeys].filter((k) => !omoCoreKeys.has(k))

    expect(
      onlyInCore,
      `Keys present in omo-config-core but missing from omo-opencode: ${onlyInCore.join(", ")}`
    ).toEqual([])

    expect(
      onlyInOpenCode,
      `Keys present in omo-opencode but missing from omo-config-core: ${onlyInOpenCode.join(", ")}`
    ).toEqual([])
  })
})
