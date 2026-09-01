import { describe, expect, test } from "bun:test"

const RECOMMENDATION_FILES = [
  "README.md",
  "README.ko.md",
  "README.ja.md",
  "README.ru.md",
  "README.zh-cn.md",
  "docs/guide/agent-model-matching.md",
  "docs/guide/orchestration.md",
  "docs/guide/installation.md",
  "docs/guide/overview.md",
  "docs/reference/configuration.md",
  "docs/reference/features.md",
  "docs/examples/coding-focused.jsonc",
  "docs/examples/default.jsonc",
  "docs/examples/planning-focused.jsonc",
  "packages/model-core/src/agent-model-requirements.ts",
  "packages/model-core/src/category-model-requirements.ts",
  "packages/web/messages/en.json",
  "packages/web/messages/ja.json",
  "packages/web/messages/ko.json",
  "packages/web/messages/zh.json",
] as const

const LEGACY_OPUS_RECOMMENDATION = /\b(?:claude[- ]?)?opus[ _-]?4[._-]?(?:6|8)\b/i

describe("Opus 5 model recommendation migration", () => {
  test("does not publish legacy Opus 4.6 or 4.8 recommendations", async () => {
    const staleReferences = (
      await Promise.all(
        RECOMMENDATION_FILES.map(async (file) => {
          const text = await Bun.file(new URL(`../${file}`, import.meta.url)).text()
          return LEGACY_OPUS_RECOMMENDATION.test(text) ? file : null
        }),
      )
    ).filter((file) => file !== null)

    expect(staleReferences).toEqual([])
  })
})
