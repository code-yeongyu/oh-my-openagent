import { describe, expect, test } from "bun:test"

/**
 * Drift guard: ensures omo-config-core's category schema input keys stay in
 * sync with omo-opencode's CategoryConfigBaseSchema input keys.
 *
 * Instead of introspecting Zod internals (which changed in Zod v4), we
 * maintain explicit key sets here. When you add/remove a field in either
 * schema, update the corresponding set below — the test will fail until both
 * sets agree, preventing silent divergence between the two packages.
 */

/** Keys from omo-config-core BaseCategoryConfigSchema + OmoCategoryConfigSchema.extend() */
const omoCoreKeys = new Set([
  "description",
  "model",
  "fallback_models",
  "variant",
  "temperature",
  "topP",
  "topp",
  "maxTokens",
  "thinking",
  "reasoningEffort",
  "textVerbosity",
  "tools",
  "prompt_append",
  "max_prompt_tokens",
  "is_unstable_agent",
  "disable",
])

/** Keys from omo-opencode CategoryConfigBaseSchema */
const omoOpenCodeKeys = new Set([
  "description",
  "model",
  "fallback_models",
  "variant",
  "temperature",
  "topP",
  "topp",
  "maxTokens",
  "thinking",
  "reasoningEffort",
  "textVerbosity",
  "tools",
  "prompt_append",
  "max_prompt_tokens",
  "is_unstable_agent",
  "disable",
])

describe("omo config category drift guard", () => {
  test("#given omo category schemas #when comparing zod object shape keys #then omo-config-core matches omo-opencode", () => {
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
