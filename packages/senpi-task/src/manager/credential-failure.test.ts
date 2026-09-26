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

  test.each([
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

  test("#given a credential rejection on the first rung #when the candidates are computed #then every rung on that provider is skipped", () => {
    const candidates = runtimeFallbackCandidates(record(GO_M3, [GO_M27, ZAI_GLM]), "401: Unauthorized")

    expect(candidates).toEqual({ remaining: [ZAI_GLM], skipped: [GO_M27] })
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
})
