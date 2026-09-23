import { describe, expect, test } from "bun:test"

import { HARNESS_NATIVE_RENAME_MIGRATION_ID, transformHarnessNativeRename } from "./harness-native-rename"

describe("transformHarnessNativeRename", () => {
  test("#given a config whose harness block is spelled [senpi] #when transformed #then it becomes [native] with every value kept", () => {
    // given
    const document = {
      categories: { quick: { model: "openai/gpt-6-astra" } },
      "[senpi]": {
        categories: { quick: { reasoning: "high" } },
        git_master: { commit_footer: true },
        telemetry: { enabled: false },
      },
      profiles: { opus: { "[senpi]": { model_profile: "opus" } } },
    }

    // when
    const result = transformHarnessNativeRename(document)

    // then
    expect(result.document).toEqual({
      categories: { quick: { model: "openai/gpt-6-astra" } },
      "[native]": {
        categories: { quick: { reasoning: "high" } },
        git_master: { commit_footer: true },
        telemetry: { enabled: false },
      },
      profiles: { opus: { "[native]": { model_profile: "opus" } } },
    })
    expect(result.diagnostics).toEqual([
      "[senpi] renamed to [native]",
      "profiles.opus.[senpi] renamed to [native]",
    ])
  })

  test("#given both [native] and [senpi] #when transformed #then the canonical block survives and the drop is reported", () => {
    // given
    const document = {
      "[native]": { model_profile: "canonical" },
      "[senpi]": { model_profile: "legacy" },
    }

    // when
    const result = transformHarnessNativeRename(document)

    // then
    expect(result.document).toEqual({ "[native]": { model_profile: "canonical" } })
    expect(result.diagnostics).toEqual(["[senpi] removed: [native] is already configured"])
  })

  test("#given a config that never named [senpi] #when transformed #then the document is unchanged with no diagnostics", () => {
    // given
    const document = {
      categories: { "deep-low": { model: "openai/gpt-6-astra" } },
      "[native]": { telemetry: { enabled: false } },
      "[codex]": { model_profile: "codex" },
    }

    // when
    const result = transformHarnessNativeRename(document)

    // then
    expect(result.document).toEqual(document)
    expect(result.diagnostics).toEqual([])
  })

  test("#given the migration id #then it stays a stable dated value", () => {
    expect(HARNESS_NATIVE_RENAME_MIGRATION_ID).toBe("2026-09-harness-native-rename")
  })
})
