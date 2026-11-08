import { describe, expect, it } from "bun:test"

import fixtureExpected from "./2026-09-subscription-provider-rename/fixture-expected.json"
import fixtureInput from "./2026-09-subscription-provider-rename/fixture-input.json"
import {
  hasLegacySubscriptionProviderIds,
  SUBSCRIPTION_PROVIDER_RENAME_MIGRATION_ID,
  transformSubscriptionProviderRename,
} from "./subscription-provider-rename"

describe("subscription provider rename migration", () => {
  it("#given an omo.jsonc written before the rename #when migrated #then every legacy id is canonical", () => {
    const { document } = transformSubscriptionProviderRename(fixtureInput)
    expect(document).toEqual(fixtureExpected)
  })

  it("#given the metered API-key lanes #when migrated #then openai and anthropic are untouched", () => {
    const { document } = transformSubscriptionProviderRename({
      a: "openai/gpt-6-astra",
      b: "anthropic/claude-opus-5-5",
      c: { openai: { x: 1 }, anthropic: { y: 2 } },
    })
    expect(document).toEqual({
      a: "openai/gpt-6-astra",
      b: "anthropic/claude-opus-5-5",
      c: { openai: { x: 1 }, anthropic: { y: 2 } },
    })
  })

  it("#given unrelated keys #when migrated #then they survive verbatim", () => {
    const untouched = { deep: { nested: [1, "two", { three: true }] }, keep: "me" }
    const { document } = transformSubscriptionProviderRename({ ...untouched, model: "openai-codex/gpt-6-astra" })
    expect(document.deep).toEqual(untouched.deep)
    expect(document.keep).toBe("me")
  })

  it("#given a config that is already canonical #when inspected #then the migration does not run", () => {
    expect(hasLegacySubscriptionProviderIds(fixtureExpected)).toBe(false)
    expect(hasLegacySubscriptionProviderIds(fixtureInput)).toBe(true)
  })

  it("#given a legacy provider id as a KEY #when migrated #then the key is renamed and its value preserved", () => {
    const { document } = transformSubscriptionProviderRename({ "claude-sdk-oauth": { tokenInjection: "config-dir" } })
    expect(document).toEqual({ "anthropic-subscription": { tokenInjection: "config-dir" } })
  })

  it("#given a rewrite #when diagnostics are read #then each names the path, the old id and the new id", () => {
    const { diagnostics } = transformSubscriptionProviderRename({ default_model: "openai-codex/gpt-6-astra" })
    expect(diagnostics).toEqual(["$.default_model: openai-codex/gpt-6-astra renamed to chatgpt-subscription/gpt-6-astra"])
  })

  it("#given the shipped id #when read #then it is the stable recorded migration id", () => {
    expect(SUBSCRIPTION_PROVIDER_RENAME_MIGRATION_ID).toBe("2026-09-subscription-provider-rename")
  })
})
