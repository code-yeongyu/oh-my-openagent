import { describe, expect, test } from "bun:test"

import { createTaskRecord, type ResolvedModelRecord, type TaskRecord } from "../state"
import { isCredentialFailure, runtimeFallbackCandidates, terminalFailureMessage } from "./credential-failure"

function rung(provider: string, modelId: string): ResolvedModelRecord {
  return { source: "category", provider, model_id: modelId, display: `${provider}/${modelId}` }
}

const GO_M3 = rung("opencode-go", "minimax-m3")
const GO_M27 = rung("opencode-go", "minimax-m2.7")
const ZAI_GLM = rung("zai", "glm-5.3")

function record(primary: ResolvedModelRecord, fallbacks: readonly ResolvedModelRecord[]): TaskRecord {
  return createTaskRecord({
    parent_session_id: "session-parent",
    root_session_id: "session-root",
    depth: 1,
    execution_mode: "in-process",
    notify_on_terminal: false,
    model: primary.display,
    requested_model: primary,
    resolved_model: primary,
    fallback_models: [...fallbacks],
  })
}

describe("isCredentialFailure", () => {
  test.each([
    ["401 without body", "401: Unauthorized"],
    ["invalid api key", '401: {"error":{"message":"Invalid API key provided"}}'],
    ["rejected OAuth refresh", 'OAuth refresh failed for anthropic: status=400; body={"error": "invalid_grant"}'],
    ["lapsed subscription (403 naming the subscription)", '403: {"message":"An active OpenCode Go subscription is required to use Go models."}'],
    ["403 naming the organization", "403: Your organization does not have access to this API"],
    ["403 naming the key", "403: This API key does not have permission to use the completions endpoint"],
    ["403 naming a suspended account", "403 Forbidden: this account has been suspended"],
  ])("#given %s #when classified #then it is a credential failure", (_label, message) => {
    expect(isCredentialFailure(message)).toBe(true)
  })

  test.each([
    ["an organization gate on one model", "403: Your organization must be verified to use this model"],
    ["a valid key refused one model", "403: The API key is valid, but access to restricted-model is forbidden. Use an allowed model."],
    ["an account gate naming the failed model id", "403: account tier does not include minimax-m3"],
  ])("#given a 403 that names the account or key but scopes itself to a model (%s) #when classified #then it is not a credential failure", (_label, message) => {
    expect(isCredentialFailure(message, "minimax-m3")).toBe(false)
  })

  // Every wording senpi emits when a provider has no credential at request time (#10806), enumerated from the
  // pinned senpi runtime (2026.10.27-1, paths under its dist/). The provider is signed out, so its sibling models
  // fail the same way.
  test.each([
    ["the session's request-time check (core/auth-guidance.js:19 formatNoApiKeyFoundMessage)", "No API key found for openai.\n\nUse /login to log into a provider via OAuth or API key. See:\n  ~/docs/providers.md"],
    ["the same check for an unknown provider (core/auth-guidance.js:19)", "No API key found for the selected model.\n\nUse /login to log into a provider via OAuth or API key."],
    ["the registry's request auth (core/model-registry.js:80, :103 getApiKeyAndHeaders)", 'No API key found for "openai"'],
    ["a provider adapter (bundle/chunks/anthropic-messages assertRequestAuth, openai/google/mistral/codex/azure stream)", "No API key for provider: openai"],
    ["the pi-messages adapter (bundle/chunks/pi-messages)", 'No API key provided for provider "openai"'],
    ["a model switch onto a keyless provider (core/model-switch-auth-error.js:4)", "No API key for openai/gpt-6-luna-fast"],
    ["a virtual model routed to a keyless provider (core/model-runtime.js:1159)", "auto routed to openai/gpt-6-luna-fast, which has no credentials."],
    ["compaction on a keyless session model (extensions/builtin/compaction/speculative.js:164)", 'summarization credentials unavailable: no credentials resolved for provider "openai"'],
    ["an empty Claude subscription pool (extensions/builtin/anthropic-subscription/auth-lane.js:21)", "authentication_failed: No Anthropic Subscription accounts configured for the managed lane; run /login anthropic-subscription or set CLAUDE_CODE_OAUTH_TOKEN"],
    ["no Claude account at all (extensions/builtin/anthropic-subscription/guidance.js:5 noAccountGuidance)", "No Claude account configured for anthropic-subscription.\n  /login anthropic-subscription  - sign in with your Claude Pro/Max subscription"],
    ["the pinned Claude account is gone, fallback off (extensions/builtin/anthropic-subscription/guidance.js:66 singleAccountUnavailableGuidance)", "Claude account 'work' for anthropic-subscription is not configured, and account fallback is off, so no other account is used.\n  /claude-account list  - see the configured accounts"],
    ["an empty Cursor CLI account pool (extensions/builtin/cursor-cli-oauth/stream.js:18)", "no accounts: run /login cursor-cli-oauth"],
    ["a missing Cursor access token (bundle/chunks/cursor-agent.js:32)", "Cursor access token is required; run /login cursor"],
    ["a missing Radius login", "Radius authentication is required; start Pi and run /login radius, then retry"],
    ["a signed-out Claude Code SDK", "Not logged in \u00b7 Please run /login"],
    ["a Radius relay with no login (radius-relay)", "Radius authentication is required"],
    ["a bare authentication requirement naming no model", "Authentication required. Run /login openai"],
    ["a coded authentication requirement naming no model", "authentication_required: sign in to openai"],
    ["a missing GitLab Duo token (custom provider example)", "No GitLab access token. Run /login gitlab-duo or set GITLAB_TOKEN"],
    ["a rejected Claude subscription token (anthropic-subscription guidance)", "The account's OAuth token was rejected. Re-run /login anthropic-subscription to refresh it, or remove the account with /claude-account remove <name>."],
  ])("#given a missing credential from %s #when classified #then it is a credential failure", (_label, message) => {
    expect(isCredentialFailure(message, "gpt-6-luna-fast")).toBe(true)
  })

  // Every wording senpi emits when a provider's stored credential has expired and only a fresh sign-in renews it.
  test.each([
    ["an expired Meta session answered with 403 (oauth/meta mintApiKey)", "Meta session expired (status 403). Run `/login meta` to sign in again."],
    ["an expired Meta session answered with 401 (oauth/meta mintApiKey)", "Meta session expired (status 401). Run `/login meta` to sign in again."],
    ["an OAuth provider whose credentials may have expired (agent-session)", `Authentication failed for "anthropic". Credentials may have expired or network is unavailable. Run '/login anthropic' to re-authenticate.`],
    ["the goal stop on a 401 (continuation-recovery)", "Goal continuation blocked: provider rejected the request: HTTP 401 authentication failed for openai/gpt-6-luna-fast.\nRetrying would get the same rejection, so the goal stopped instead of retrying.\nRun /login openai to sign in again, or check the API key or token for openai, and check any proxy or gateway in front of it. Then send any message to resume."],
  ])("#given an expired or rejected credential from %s #when classified #then it is a credential failure", (_label, message) => {
    expect(isCredentialFailure(message, "gpt-6-luna-fast")).toBe(true)
  })

  // senpi names /login in guidance that is not about a missing or rejected credential; a /login hint alone
  // must not sign the provider out.
  test.each([
    ["a GitHub Copilot 421 endpoint refresh (github-copilot-errors)", "GitHub Copilot sent this account to a different API host (HTTP 421 Misdirected Request): Business and Enterprise accounts are served from their own host, which senpi reads from the Copilot token. Run /login github-copilot so senpi stores the account's endpoint, and report it with the GitHub request id if it persists."],
    ["a GitHub Copilot model-scoped 403 (github-copilot-errors)", "GitHub Copilot refused the request (HTTP 403). Copilot checks access per model and per client; if a fresh /login github-copilot does not help, report it with the GitHub request id."],
    ["the subscription usage poller's stale-auth status (usage-accounts)", "auth stale - run /login"],
    ["Anthropic third-party billing (provider-failure-description)", 'Anthropic billed this request to your extra usage instead of your Claude plan limits, because a Claude subscription used directly through the Anthropic API counts as a third-party app. Run /login and choose "Anthropic Subscription (Claude Pro/Max)" so requests run through Claude Code and use your plan limits, add extra usage at https://claude.ai/settings/usage, or switch to another model with /model.'],
    ["the goal stop on a model-scoped 403 (continuation-recovery)", "Goal continuation blocked: provider rejected the request: HTTP 403 access denied for github-copilot/gpt-6-luna-fast.\nRetrying would get the same rejection, so the goal stopped instead of retrying.\nRun /login github-copilot to refresh the account, or check that gpt-6-luna-fast is enabled for your Copilot plan, and check any proxy or gateway in front of it. Then send any message to resume."],
  ])("#given /login guidance that is not about a missing credential (%s) #when classified #then it is not a credential failure", (_label, message) => {
    expect(isCredentialFailure(message, "gpt-6-luna-fast")).toBe(false)
  })

  // A sign-in requirement that names a model (by the word or by the failed model's id) may hold for that model
  // alone, so the provider's other models stay: one row per requirement phrasing.
  test.each([
    ["access token is required, for a model", "Access token is required for this model"],
    ["authentication is required, for a model", "Authentication is required for this model"],
    ["authentication required, for a model", "Authentication required for this model"],
    ["authentication_required, for a model", "authentication_required: this model needs a separate sign-in"],
    ["access token is required, naming the model id", "Access token is required for gpt-6-luna-fast"],
    ["authentication is required, naming the model id", "Authentication is required for gpt-6-luna-fast"],
    ["authentication required, naming the model id", "Authentication required for gpt-6-luna-fast"],
    ["authentication_required, naming the model id", "authentication_required: gpt-6-luna-fast needs a separate sign-in"],
  ])("#given a sign-in requirement scoped to one model (%s) #when classified #then it is not a credential failure", (_label, message) => {
    expect(isCredentialFailure(message, "gpt-6-luna-fast")).toBe(false)
  })

  // Other senpi texts that say "expired" or "sign in again" without a model request's credential having
  // expired: a device-login flow timing out, an MCP server session, a prompt cache, a one-time migration notice.
  test.each([
    ["a Meta device login that timed out (oauth/meta)", "Meta device authorization expired. Please restart login."],
    ["a Kimi Code device login that timed out (oauth/kimi-coding)", "Kimi Code device authorization expired. Please restart login."],
    ["a Radius device login that timed out (oauth/radius)", "Device authorization expired."],
    ["an xAI device login that timed out (oauth/xai)", "xAI device code expired"],
    ["an expired MCP server session (mcp/health)", "MCP server docs session expired; reinitialize retry also expired; run /mcp reconnect docs"],
    ["an expired MCP authorization code (mcp/auth/oauth)", "MCP server docs authorization code was rejected or expired; restart with /mcp auth-start docs."],
    ["a tool server whose access token was rejected (MCP-style)", "MCP server docs access token was rejected"],
    // An HTTP proxy that wants its own login is not the provider's credential: the provider's other models sit
    // behind the same proxy, and signing in to the provider does not help. The undici rows are its exact texts as
    // bundled in senpi (bundle/chunks/session-worker.js:534, :622).
    ["undici's ProxyAgent 407", "Proxy Authentication Required (407)"],
    ["undici fetch's proxy network error", "TypeError: fetch failed: proxy authentication required"],
    ["undici's tunnel refusal", "Proxy response (407) !== 200 when HTTP Tunneling"],
    ["a 407 status line", "407 Proxy Authentication Required"],
    ["a proxy whose login was refused", "Proxy authentication failed for the configured HTTPS_PROXY"],
    ["an expired prompt cache (handoff-hint)", "This session is 180k tokens and its cache has expired."],
    ["the subscription login migration notice (auth-storage)", 'The Anthropic Claude subscription login in auth.json was not moved to Anthropic Subscription because a newer login exists. It was left unchanged; sign in again with /login and choose "Anthropic Subscription (Claude Pro/Max)".'],
  ])("#given an expiry or sign-in text that is not a model credential failure (%s) #when classified #then it is not a credential failure", (_label, message) => {
    expect(isCredentialFailure(message, "gpt-6-luna-fast")).toBe(false)
  })

  test.each([
    ["no model selected at all, which names no provider", "No model selected.\n\nUse /login to log into a provider via OAuth or API key.\n\nThen use /model to select a model."],
    ["a model-scoped 403", '403: {"error":{"message":"This model is not enabled for your project. Contact support to request access."}}'],
    ["a bare forbidden", "403 Forbidden"],
    ["a region-gated model", "403: gpt-6-astra is not available in your region"],
    ["a 500", "500: upstream overloaded"],
    ["a 429", "429: rate limited, retry after 3s"],
    ["a context overflow", "400: prompt is too long: 213000 tokens > 200000 maximum"],
  ])("#given %s #when classified #then it is not a credential failure", (_label, message) => {
    expect(isCredentialFailure(message)).toBe(false)
  })
})

describe("runtimeFallbackCandidates", () => {
  test("#given a model-scoped 403 on the first rung #when the candidates are computed #then the sibling model on the same provider stays", () => {
    const candidates = runtimeFallbackCandidates(record(GO_M3, [GO_M27, ZAI_GLM]), "403: This model is not enabled for your project.")

    expect(candidates).toEqual({ remaining: [GO_M27, ZAI_GLM], skipped: [] })
  })

  test.each([
    ["403: Your organization must be verified to use this model"],
    ["403: The API key is valid, but access to restricted-model is forbidden. Use an allowed model."],
  ])("#given a model-scoped 403 that names the organization or key (%s) #when the candidates are computed #then the allowed sibling stays and no re-authentication is prescribed", (message) => {
    const failed = record(GO_M3, [GO_M27, ZAI_GLM])

    expect(runtimeFallbackCandidates(failed, message)).toEqual({ remaining: [GO_M27, ZAI_GLM], skipped: [] })
    expect(terminalFailureMessage(record(GO_M3, []), message)).toBe(message)
  })

  test("#given senpi's missing-key text on an API-key rung and a parent on the subscription #when the candidates are computed #then the other API-key rung is skipped and the parent's model is next (#10806)", () => {
    const selected = rung("openai", "gpt-6-luna-fast")
    const sibling = rung("openai", "another")
    const parent = rung("chatgpt-subscription", "gpt-6-luna-fast")
    const failed: TaskRecord = { ...record(selected, [sibling, parent]), parent_model: parent.display }

    const candidates = runtimeFallbackCandidates(failed, "No API key found for openai.")

    expect(candidates).toEqual({ remaining: [parent], skipped: [sibling] })
  })

  test("#given a credential rejection on the first rung #when the candidates are computed #then every rung on that provider is skipped", () => {
    const candidates = runtimeFallbackCandidates(record(GO_M3, [GO_M27, ZAI_GLM]), "401: Unauthorized")

    expect(candidates).toEqual({ remaining: [ZAI_GLM], skipped: [GO_M27] })
  })

  test.each([
    ["a Claude session limit", "You've hit your session limit \u00b7 resets 3pm (Asia/Seoul)"],
    ["an OpenCode Go monthly limit", "429 Monthly usage limit reached. It will reset in 2 days 8 hours"],
    ["a Codex usage limit", '429 {"type":"usage_limit_reached","message":"The usage limit has been reached"}'],
    ["senpi's account limit text, which points at /model", "The anthropic-subscription account usage limit has been reached (resets 3:20am). Switch to another provider with /model, or configure another provider in retry.fallbackChains."],
  ])("#given %s on the first rung #when the candidates are computed #then other providers come first and the spent provider's rungs stay as the last resort", (_label, message) => {
    const candidates = runtimeFallbackCandidates(record(GO_M3, [GO_M27, ZAI_GLM]), message)

    expect(candidates).toEqual({ remaining: [ZAI_GLM, GO_M27], skipped: [], limit: "account" })
  })

  test("#given a limit that names one model #when the candidates are computed #then the sibling model on the same provider is next", () => {
    const candidates = runtimeFallbackCandidates(record(GO_M3, [GO_M27, ZAI_GLM]), "You've hit your Fable weekly limit \u00b7 resets Oct 2, 9am")

    expect(candidates).toEqual({ remaining: [GO_M27, ZAI_GLM], skipped: [], limit: "model" })
  })

  describe("the parent session's model as the last rung (#10750)", () => {
    const PARENT = rung("chatgpt-subscription", "gpt-6.1-sol")
    const SPENT_PARENT = rung("opencode-go", "minimax-m2.7")
    const withParent = (parent: ResolvedModelRecord): TaskRecord => ({ ...record(GO_M3, [ZAI_GLM, parent]), parent_model: parent.display })

    test.each([
      ["a usage limit", "429 Monthly usage limit reached. It will reset in 2 days 8 hours"],
      ["a signed-out provider", "401: Unauthorized"],
    ])("#given %s #when the candidates are computed #then the parent's model stays after the category rungs", (_label, message) => {
      expect(runtimeFallbackCandidates(withParent(PARENT), message).remaining).toEqual([ZAI_GLM, PARENT])
    })

    test("#given a failure that is not a limit or a sign-in #when the candidates are computed #then the parent's model is not offered", () => {
      expect(runtimeFallbackCandidates(withParent(PARENT), "500: upstream overloaded").remaining).toEqual([ZAI_GLM])
    })

    test("#given the parent runs on the account whose limit is spent #when the candidates are computed #then the parent's model is skipped", () => {
      const candidates = runtimeFallbackCandidates(withParent(SPENT_PARENT), "429 Monthly usage limit reached. It will reset in 2 days 8 hours")

      expect(candidates).toEqual({ remaining: [ZAI_GLM], skipped: [SPENT_PARENT], limit: "account" })
    })
  })
})

describe("terminalFailureMessage", () => {
  test("#given a model-scoped 403 #when the terminal message is built #then no re-authentication is prescribed", () => {
    const message = terminalFailureMessage(record(GO_M3, []), "403: This model is not enabled for your project.")

    expect(message).toBe("403: This model is not enabled for your project.")
  })

  test("#given a credential rejection #when the terminal message is built #then both re-authentication paths and the alternatives are named", () => {
    const message = terminalFailureMessage(record(GO_M3, []), "401: Unauthorized")

    expect(message).toContain("re-authenticate opencode-go")
    expect(message).toContain("Provider authentication settings")
    expect(message).toContain("/login opencode-go")
    expect(message).toContain("omo.json")
  })

  test("#given a missing credential #when the terminal message is built #then it says none was found instead of rejected", () => {
    const message = terminalFailureMessage(record(GO_M3, []), "No API key found for opencode-go.")

    expect(message).toContain("No credentials for opencode-go were found")
    expect(message).toContain("/login opencode-go")
    expect(message).not.toContain("were rejected")
  })

  test("#given a single-model lane whose only model hits an account usage limit #when the terminal message is built #then it says the chain is exhausted and how to recover", () => {
    const astra = { ...rung("chatgpt-subscription", "gpt-6-astra"), display: "GPT-6 Astra" }
    const limit = `403: {"message":"You've reached your usage limit for this billing cycle.","type":"access_terminated_error"}`

    const message = terminalFailureMessage(record(astra, []), limit)

    expect(message.startsWith(limit)).toBe(true)
    expect(message).toContain("chatgpt-subscription/gpt-6-astra reached its usage limit, so this task stopped.")
    expect(message).toContain("No other model in its fallback chain could take over.")
    expect(message).toContain("omo.json")
  })

  test("#given a usage limit while fallback rungs remain #when the terminal message is built #then it does not claim the chain is exhausted", () => {
    const message = terminalFailureMessage(record(GO_M3, [ZAI_GLM]), "You've hit your session limit")

    expect(message).toContain("opencode-go/minimax-m3 reached its usage limit, so this task stopped.")
    expect(message).not.toContain("No other model")
  })

  test("#given an ordinary provider error #when the terminal message is built #then it is passed through unchanged", () => {
    expect(terminalFailureMessage(record(GO_M3, []), "500: upstream connect error")).toBe("500: upstream connect error")
  })
})
