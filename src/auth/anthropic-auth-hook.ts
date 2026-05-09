/**
 * OpenCode auth hook for Anthropic Claude Pro/Max OAuth.
 *
 * Registers the "anthropic" provider with an OAuth login method
 * so users can run `/login` and authenticate with their Claude subscription.
 * This enables Claude Max 20x usage through Oh-My-OpenAgent.
 *
 * Token resolution priority:
 *   1. OMP's agent.db (shares the same OAuth session as Oh-My-Pi)
 *   2. Standard OAuth token refresh (direct against Anthropic API)
 */

import type { AuthHook } from "@opencode-ai/plugin"
import { authorizeAnthropic, refreshAnthropicToken } from "./anthropic-oauth"
import { syncOmpCredentials } from "./omp-credential-sync"

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
     * the anthropic provider.
     *
     * Always tries OMP's credential store first. If OMP has a valid
     * token, we use it directly — no refresh needed, no separate
     * auth state to manage. Both tools share one session.
     */
    async loader(auth) {
      const now = Date.now()

      // ── Priority 1: Read from OMP's agent.db ─────────────────────────
      // This is synchronous (bun:sqlite) and fast (~0.1ms).
      const omp = syncOmpCredentials()
      if (omp && omp.access && omp.expires > now) {
        return {
          apiKey: omp.access,
          _refreshed: {
            access: omp.access,
            refresh: omp.refresh,
            expires: omp.expires,
          },
        }
      }

      // ── Fallback: Use OpenCode's own stored credentials ──────────────
      const stored = await auth()
      if (!stored) return {}

      // API key auth — pass through
      if (stored.type === "api") {
        return {}
      }

      // OAuth auth — check expiry and refresh if needed
      if (stored.type === "oauth") {
        if (stored.expires > now) {
          return { apiKey: stored.access }
        }

        // Token expired — try standard OAuth refresh
        try {
          const refreshed = await refreshAnthropicToken(stored.refresh)
          return {
            apiKey: refreshed.access,
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

            if (res.status === 401) {
              return { type: "failed" as const }
            }

            return { type: "success" as const, key }
          } catch {
            return { type: "success" as const, key }
          }
        },
      },
    ],
  }
}
