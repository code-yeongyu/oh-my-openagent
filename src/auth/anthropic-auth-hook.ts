/**
 * OpenCode auth hook for Anthropic Claude Pro/Max OAuth.
 *
 * Registers the "anthropic" provider with an OAuth login method
 * so users can run `/login` and authenticate with their Claude subscription.
 * This enables Claude Max 20x usage through Oh-My-OpenAgent.
 */

import type { AuthHook } from "@opencode-ai/plugin"
import { authorizeAnthropic, refreshAnthropicToken } from "./anthropic-oauth"

/**
 * Creates the auth hook that OpenCode's plugin system uses to
 * show "Anthropic (Claude Pro/Max)" in the `/login` provider list
 * and handle the full OAuth flow.
 */
export function createAnthropicAuthHook(): AuthHook {
  return {
    provider: "anthropic",

    /**
     * Token loader — called by OpenCode before each API request to
     * the anthropic provider. Refreshes expired tokens automatically.
     */
    async loader(auth) {
      const stored = await auth()
      if (!stored) return {}

      // API key auth — pass through, nothing to refresh
      if (stored.type === "api") {
        return {}
      }

      // OAuth auth — check expiry and refresh if needed
      if (stored.type === "oauth") {
        const now = Date.now()
        if (stored.expires > now) {
          // Token is still valid
          return {
            apiKey: stored.access,
          }
        }

        // Token expired — refresh it
        try {
          const refreshed = await refreshAnthropicToken(stored.refresh)
          // The refreshed credentials will be stored by the caller
          // We return the new access token for immediate use
          return {
            apiKey: refreshed.access,
            // Signal to OpenCode to persist the refreshed token
            _refreshed: {
              access: refreshed.access,
              refresh: refreshed.refresh,
              expires: refreshed.expires,
            },
          }
        } catch (err) {
          console.error(
            "[oh-my-openagent] Failed to refresh Anthropic OAuth token:",
            err instanceof Error ? err.message : err,
          )
          // Return stale token — the API will reject it and the user
          // will need to re-login
          return { apiKey: stored.access }
        }
      }

      return {}
    },

    methods: [
      {
        type: "oauth" as const,
        label: "Claude Pro/Max (OAuth)",

        async authorize() {
          return authorizeAnthropic()
        },
      },
      {
        type: "api" as const,
        label: "API Key",
        prompts: [
          {
            type: "text" as const,
            key: "key",
            message: "Enter your Anthropic API key",
            placeholder: "sk-ant-...",
            validate(value: string) {
              if (!value.trim()) return "API key is required"
              return undefined
            },
          },
        ],

        async authorize(inputs?: Record<string, string>) {
          const key = inputs?.key?.trim()
          if (!key) return { type: "failed" as const }

          // Validate the key with a lightweight API call
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1,
                messages: [{ role: "user", content: "hi" }],
              }),
              signal: AbortSignal.timeout(15_000),
            })

            // 200 or 400 (bad request shape) both prove the key is valid
            // 401 means invalid key
            if (res.status === 401) {
              return { type: "failed" as const }
            }

            return {
              type: "success" as const,
              key,
            }
          } catch {
            // Network error — accept the key anyway (offline use)
            return {
              type: "success" as const,
              key,
            }
          }
        },
      },
    ],
  }
}
