import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { toV1Event } from "../../v2/event-shape"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

describe("Claude subscription quota retry status", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
    releaseAllPromptAsyncReservationsForTesting()
  })

  for (const [message, expectedCount] of [
    ["You've hit your session limit · resets 12:40am (Africa/Cairo) · limit resets in 12m (2026-10-16T21:40:00.000Z)", 1],
    ["You've hit your weekly limit · resets Oct 20", 1],
    ["Prompt exceeds the context window", 0],
    ["terminal quota exhausted", 0],
    ["Normal progress update", 0],
  ] as const) {
    test(`dispatches ${expectedCount} cross-provider continuations for ${message}`, async () => {
      const sessionID = "ses_quota_status_regression"
      const prompts: Array<{ body: { model: unknown; parts: unknown } }> = []
      const aborts: unknown[] = []
      const hook = createRuntimeFallbackHook(
        unsafeTestValue<RuntimeFallbackPluginInput>({
          directory: "/test/dir",
          client: {
            tui: { showToast: async () => ({}) },
            session: {
              abort: async (args: unknown) => { aborts.push(args); return {} },
              messages: async () => ({ data: [{
                info: { role: "user", agent: "Sisyphus-Junior", model: { providerID: "claude-code", modelID: "sonnet" } },
                parts: [{ type: "text", text: "Finish the requested implementation" }],
              }] }),
              promptAsync: async (args: { body: { model: unknown; parts: unknown } }) => {
                prompts.push(args)
                return {}
              },
            },
          },
        }),
        {
          config: { enabled: true, retry_on_errors: [429, 500, 502, 503, 504, 529],
            max_fallback_attempts: 5, cooldown_seconds: 600, notify_on_fallback: false,
            restore_primary_after_cooldown: true },
          pluginConfig: {
            git_master: { commit_footer: true, include_co_authored_by: true, git_env_prefix: "GIT_MASTER_" },
            agents: { "sisyphus-junior": { fallback_models: ["openai/gpt-6.1-sol"] } },
          },
        },
      )
      try {
        await hook.event({ event: toV1Event({ type: "session.created", data: { sessionID } }) })
        await hook.event({ event: toV1Event({ type: "session.retry.scheduled", data: {
          sessionID, attempt: 2,
          error: { message, detail: { error: { type: "rate_limit_error", code: "claude_session_limit" } } },
        } }) })
        expect(aborts).toHaveLength(expectedCount)
        expect(prompts).toHaveLength(expectedCount)
        if (expectedCount > 0) {
          expect(prompts[0]?.body.model).toEqual({ providerID: "openai", modelID: "gpt-6.1-sol" })
          expect(prompts[0]?.body.parts).toEqual([{ type: "text", text: "Finish the requested implementation" }])
        }
      } finally {
        await hook.dispose?.()
      }
    })
  }
})
