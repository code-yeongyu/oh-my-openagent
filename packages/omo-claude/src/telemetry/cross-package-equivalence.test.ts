import { describe, expect, it } from "bun:test"

import * as cliIdentity from "./product-identity"

describe("cross-package telemetry identity equivalence", () => {
  describe("#given the omo-claude CLI telemetry product-identity module and the Claude Code plugin component product-identity module", () => {
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

  describe("#given the omo-claude CLI env-flags module and the Claude Code plugin component env-flags module", () => {
    it("#when shouldDisablePostHog is checked under each opt-out env var #then both modules disable on the same flags", async () => {
      const cliEnv = await import("./env-flags")
      const pluginEnv = await import(
        "../../plugin/components/telemetry/src/env-flags"
      )

      const flags = [
        "OMO_DISABLE_POSTHOG",
        "OMO_SEND_ANONYMOUS_TELEMETRY",
        "OMO_CLAUDE_DISABLE_POSTHOG",
        "OMO_CLAUDE_SEND_ANONYMOUS_TELEMETRY",
      ] as const
      const previousValues = new Map<string, string | undefined>()
      for (const flag of flags) {
        previousValues.set(flag, process.env[flag])
        delete process.env[flag]
      }
      try {
        expect(cliEnv.shouldDisablePostHog()).toBe(false)
        expect(pluginEnv.shouldDisablePostHog()).toBe(false)

        for (const optOutFlag of ["OMO_DISABLE_POSTHOG", "OMO_CLAUDE_DISABLE_POSTHOG"] as const) {
          process.env[optOutFlag] = "1"
          expect(cliEnv.shouldDisablePostHog()).toBe(true)
          expect(pluginEnv.shouldDisablePostHog()).toBe(true)
          delete process.env[optOutFlag]
        }

        for (const sendFlag of ["OMO_SEND_ANONYMOUS_TELEMETRY", "OMO_CLAUDE_SEND_ANONYMOUS_TELEMETRY"] as const) {
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

describe("cross-product telemetry identity distinctness", () => {
  describe("#given the omo-claude product-identity module and the omo-codex product-identity module", () => {
    it("#when both are imported #then EVENT_NAME differs but the shared PostHog project key, host, and LEGACY_PARENT_PACKAGE are equal", async () => {
      const codexIdentity = await import(
        "../../../omo-codex/src/telemetry/product-identity.ts"
      )

      // Distinct branding — must NOT collide across products.
      expect(cliIdentity.EVENT_NAME).not.toBe(codexIdentity.EVENT_NAME)
      expect(cliIdentity.EVENT_NAME).toBe("omo_claude_daily_active")
      expect(codexIdentity.EVENT_NAME).toBe("omo_codex_daily_active")
      expect(cliIdentity.PRODUCT_NAME).not.toBe(codexIdentity.PRODUCT_NAME)
      expect(cliIdentity.PACKAGE_NAME).not.toBe(codexIdentity.PACKAGE_NAME)
      expect(cliIdentity.CACHE_DIR_NAME).not.toBe(codexIdentity.CACHE_DIR_NAME)

      // Shared PostHog project — must be byte-identical across products.
      expect(cliIdentity.DEFAULT_POSTHOG_API_KEY).toBe(codexIdentity.DEFAULT_POSTHOG_API_KEY)
      expect(cliIdentity.DEFAULT_POSTHOG_HOST).toBe(codexIdentity.DEFAULT_POSTHOG_HOST)
      expect(cliIdentity.LEGACY_PARENT_PACKAGE).toBe(codexIdentity.LEGACY_PARENT_PACKAGE)
    })
  })

  describe("#given the omo-claude posthog module and the omo-codex posthog module", () => {
    it("#when getPostHogDistinctId is computed on each #then the distinct-id seeds differ", async () => {
      const fixedHostname = "distinctness-test-host"
      const osOverride = {
        arch: () => "arm64" as const,
        cpus: () => [],
        hostname: () => fixedHostname,
        platform: () => "darwin" as const,
        release: () => "0.0.0",
        totalmem: () => 0,
        type: () => "Darwin",
      }

      const claudePosthog = await import("./posthog")
      const codexPosthog = await import(
        "../../../omo-codex/src/telemetry/posthog.ts"
      )

      claudePosthog.__setOsProviderForTesting(osOverride)
      codexPosthog.__setOsProviderForTesting(osOverride)
      try {
        const claudeId = claudePosthog.getPostHogDistinctId()
        const codexId = codexPosthog.getPostHogDistinctId()

        // Same hostname, different salt → different distinct id.
        expect(claudeId).not.toBe(codexId)
      } finally {
        claudePosthog.__resetOsProviderForTesting()
        codexPosthog.__resetOsProviderForTesting()
      }
    })
  })
})
