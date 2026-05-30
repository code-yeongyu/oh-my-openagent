import { describe, expect, it } from "bun:test"

import * as cliIdentity from "./product-identity"

describe("cross-package telemetry identity equivalence", () => {
  describe("#given the omo-codex CLI telemetry product-identity module and the Codex plugin component product-identity module", () => {
    it("#when both are imported #then PRODUCT_NAME, PACKAGE_NAME, CACHE_DIR_NAME, EVENT_NAME, DEFAULT_POSTHOG_HOST, and DEFAULT_POSTHOG_API_KEY are identical", async () => {
      const pluginIdentity = await import(
        "../../plugin/components/telemetry/src/product-identity"
      )

      expect(pluginIdentity.PRODUCT_NAME).toBe(cliIdentity.PRODUCT_NAME)
      expect(pluginIdentity.PACKAGE_NAME).toBe(cliIdentity.PACKAGE_NAME)
      expect(pluginIdentity.CACHE_DIR_NAME).toBe(cliIdentity.CACHE_DIR_NAME)
      expect(pluginIdentity.EVENT_NAME).toBe(cliIdentity.EVENT_NAME)
      expect(pluginIdentity.DEFAULT_POSTHOG_HOST).toBe(cliIdentity.DEFAULT_POSTHOG_HOST)
      expect(pluginIdentity.DEFAULT_POSTHOG_API_KEY).toBe(cliIdentity.DEFAULT_POSTHOG_API_KEY)
      expect(pluginIdentity.LEGACY_PARENT_PACKAGE).toBe(cliIdentity.LEGACY_PARENT_PACKAGE)
    })
  })

  describe("#given the omo-codex CLI env-flags module and the Codex plugin component env-flags module", () => {
    it("#when shouldDisablePostHog is checked under each opt-out env var #then both modules disable on the same flags", async () => {
      const cliEnv = await import("./env-flags")
      const pluginEnv = await import(
        "../../plugin/components/telemetry/src/env-flags"
      )

      const flags = [
        "OMO_DISABLE_POSTHOG",
        "OMO_SEND_ANONYMOUS_TELEMETRY",
        "OMO_CODEX_DISABLE_POSTHOG",
        "OMO_CODEX_SEND_ANONYMOUS_TELEMETRY",
      ] as const
      const previousValues = new Map<string, string | undefined>()
      for (const flag of flags) {
        previousValues.set(flag, process.env[flag])
        delete process.env[flag]
      }
      try {
        expect(cliEnv.shouldDisablePostHog()).toBe(false)
        expect(pluginEnv.shouldDisablePostHog()).toBe(false)

        for (const optOutFlag of ["OMO_DISABLE_POSTHOG", "OMO_CODEX_DISABLE_POSTHOG"] as const) {
          process.env[optOutFlag] = "1"
          expect(cliEnv.shouldDisablePostHog()).toBe(true)
          expect(pluginEnv.shouldDisablePostHog()).toBe(true)
          delete process.env[optOutFlag]
        }

        for (const sendFlag of ["OMO_SEND_ANONYMOUS_TELEMETRY", "OMO_CODEX_SEND_ANONYMOUS_TELEMETRY"] as const) {
          process.env[sendFlag] = "0"
          expect(cliEnv.shouldDisablePostHog()).toBe(true)
          expect(pluginEnv.shouldDisablePostHog()).toBe(true)
          delete process.env[sendFlag]
        }
      } finally {
        for (const flag of flags) {
          const previous = previousValues.get(flag)
          if (previous === undefined) {
            delete process.env[flag]
          } else {
            process.env[flag] = previous
          }
        }
      }
    })
  })
})
