/// <reference types="bun-types" />

import { describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../../extension/compose"
import type { ComponentContext } from "../../extension/types"
import {
  createModelProfileComponent,
  MODEL_PROFILE_APPLIED_TYPE,
  MODEL_PROFILE_UNAVAILABLE_TYPE,
  MODEL_PROFILE_UNKNOWN_TYPE,
} from "./index"

type FakeModel = { readonly provider: string; readonly id: string }

const FABLE: FakeModel = { provider: "anthropic", id: "claude-fable-5-1" }
const OPUS: FakeModel = { provider: "anthropic", id: "claude-opus-5-5" }
const KIMI: FakeModel = { provider: "moonshotai", id: "kimi-k3" }
const GLM: FakeModel = { provider: "zai", id: "glm-5.3" }
const SOL: FakeModel = { provider: "github-copilot", id: "gpt-6-sol" }
const SOL_56_COPILOT: FakeModel = { provider: "github-copilot", id: "gpt-5.6-sol" }
const SOL_FAST: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6-sol-fast" }
const ASTRA: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6-astra" }
const UNRELATED: FakeModel = { provider: "example", id: "nothing-in-any-chain" }
const SUBSCRIPTION_OPUS: FakeModel = { provider: "anthropic-subscription", id: "claude-opus-5-5" }
const GATEWAY_OPUS: FakeModel = { provider: "opengateway", id: "anthropic/claude-opus-5-5" }
const CODING_KIMI: FakeModel = { provider: "kimi-coding", id: "kimi-k3" }

type FakeCredential = { readonly accounts?: readonly { readonly name: string }[]; readonly pinned?: string }
type FakeGetAuth = (target: string | FakeModel, overrides?: { readonly slotName?: string }) => Promise<unknown>

function registry(
  models: readonly FakeModel[],
  getAuth?: FakeGetAuth,
  credentials: Record<string, FakeCredential> = {},
  runtimeKeyProviders: readonly string[] = [],
) {
  return {
    getAvailable: () => [...models],
    find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
    ...(getAuth === undefined ? {} : { modelRuntime: { getAuth } }),
    authStorage: { get: (provider: string) => credentials[provider] },
    getProviderAuthStatus: (provider: string) =>
      runtimeKeyProviders.includes(provider) ? { configured: true, source: "runtime" } : { configured: true, source: "stored" },
  }
}

// Values that must never reach a notice, a details object, or a log line: a long opaque marker and a
// short credential in the formats providers actually echo (a bearer header, a JSON token field).
const PRIVATE_MARKER = "SYNTHETIC_PRIVATE_MARKER_9f8e7d6c5b4a"
const SHORT_SECRET = "sk-short-7q"

// senpi maps a rejected refresh onto ModelsError code "oauth" whose message carries the exchange
// detail (request headers, URL, response body).
function refreshRejected(provider: string): Error {
  const error = new Error(
    `OAuth refresh failed for ${provider}: Authorization: Bearer ${SHORT_SECRET} {"access_token":"${SHORT_SECRET}"} url=https://example.invalid/oauth/token?refresh_token=${SHORT_SECRET}; details=Error: body={"error":"invalid_grant","marker":"${PRIVATE_MARKER}"}`,
  )
  error.name = "ModelsError"
  return Object.assign(error, { code: "oauth" })
}

// A model header whose `!command` fails: senpi quotes the command in the message.
function requestConfigurationFailed(model: FakeModel): Error {
  return new Error(`Failed to resolve model "${model.provider}/${model.id}" header x-token from shell command: echo ${PRIVATE_MARKER} ${SHORT_SECRET}`)
}

type ProbeFailures = {
  readonly dead?: readonly string[]
  readonly deadSlots?: readonly string[]
  readonly broken?: readonly string[]
}

// `ModelRuntime.getAuth` as senpi implements it: a provider string resolves that credential (one
// named slot when asked), a model additionally resolves the model's own request configuration.
// Providers in `dead` (or `provider@slot` in `deadSlots`) throw the refresh error, selectors in
// `broken` throw the request-configuration error, and every probe is recorded in `calls` as
// `provider[@slot]` or `provider/model[@slot]`.
function authProbe(failures: ProbeFailures = {}) {
  const calls: string[] = []
  const getAuth: FakeGetAuth = async (target, overrides) => {
    const slot = overrides?.slotName === undefined ? "" : `@${overrides.slotName}`
    if (typeof target === "string") {
      calls.push(`${target}${slot}`)
      if (failures.dead?.includes(target) || failures.deadSlots?.includes(`${target}${slot}`)) throw refreshRejected(target)
      return { auth: { apiKey: "resolved" } }
    }
    calls.push(`${target.provider}/${target.id}${slot}`)
    if (failures.broken?.includes(`${target.provider}/${target.id}`)) throw requestConfigurationFailed(target)
    return { auth: { apiKey: "resolved" } }
  }
  return { getAuth, calls }
}

function context(logs: string[]): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: { error() {}, info: (message) => logs.push(`info:${message}`), warn: (message) => logs.push(`warn:${message}`) },
  }
}

function harness(
  config: OmoConfig,
  models: readonly FakeModel[] = [FABLE, OPUS, KIMI],
  auth?: FakeGetAuth,
  credentials?: Record<string, FakeCredential>,
  runtimeKeyProviders?: readonly string[],
) {
  const pi = new FakeExtensionAPI()
  const logs: string[] = []
  const agentDir = mkdtempSync(join(tmpdir(), "omo-model-profile-"))
  createModelProfileComponent({
    loadConfig: () => ({ config, diagnostics: [], layers: [], sources: [] }),
  }).register(pi, context(logs))
  const eventCtx = (sessionId = "session-1", mode = "rpc") => ({
    mode,
    cwd: "/project",
    agentDir,
    modelRegistry: registry(models, auth, credentials, runtimeKeyProviders),
    sessionManager: { getSessionId: () => sessionId },
  })
  const start = (payload: Record<string, unknown>, sessionId?: string, mode?: string) =>
    pi.dispatch("session_start", { type: "session_start", ...payload }, eventCtx(sessionId, mode))
  return { pi, logs, agentDir, start }
}

const STARTUP = { reason: "startup", initialModelProvenance: "settings" }

function appliedContent(pi: FakeExtensionAPI): string {
  const content = pi.messages[0]?.message["content"]
  return typeof content === "string" ? content : ""
}

describe("createModelProfileComponent", () => {
  test("#given a TUI session #when it starts #then no profile applies, set or unset", async () => {
    for (const config of [{}, { model_profile: "daily-heavy" }, { model_profile: "anthropic/claude-fable-5-1" }] satisfies OmoConfig[]) {
      const { pi, start } = harness(config)

      await start(STARTUP, "session-tui", "tui")

      expect(pi.sessionModels).toEqual([])
      expect(pi.sessionThinkingLevels).toEqual([])
      expect(pi.messages).toHaveLength(0)
    }
  })

  test("#given model_profile unset #when the session starts #then the recommended ladder is applied", async () => {
    const { pi, start } = harness({})

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      display: true,
      details: { profile: "recommended", model: "anthropic/claude-opus-5-5", reasoning: "medium", skipped: [] },
    })
    expect(appliedContent(pi)).toContain('"recommended" (Recommended)')
    expect(appliedContent(pi)).toContain("anthropic/claude-opus-5-5 medium")
  })

  test("#given a blank model_profile #when the session starts #then the recommended ladder is applied", async () => {
    const { pi, start } = harness({ model_profile: "   " })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE, details: { profile: "recommended" } })
  })

  test("#given unset and Opus only through a gateway aggregator #when the session starts #then the gateway is skipped and kimi max is applied", async () => {
    const { pi, start } = harness({}, [GATEWAY_OPUS, CODING_KIMI])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([CODING_KIMI])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(pi.messages[0]?.message).toMatchObject({
      details: { profile: "recommended", model: "kimi-coding/kimi-k3", reasoning: "max" },
    })
  })

  test("#given unset and Opus on both the API and the Claude subscription #when the session starts #then the subscription lane wins", async () => {
    const { pi, start } = harness({}, [OPUS, SUBSCRIPTION_OPUS, KIMI])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SUBSCRIPTION_OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
  })

  test("#given daily-normal and Opus only through a gateway #when the session starts #then the lane keeps its cross-provider fallback", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" }, [GATEWAY_OPUS, CODING_KIMI])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GATEWAY_OPUS])
  })

  test("#given daily-normal with only the third rung #when the session starts #then kimi max is applied and skipped rungs are named", async () => {
    const { pi, agentDir, start } = harness({ model_profile: "daily-normal" }, [KIMI, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([KIMI])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      display: true,
      details: {
        profile: "daily-normal",
        model: "moonshotai/kimi-k3",
        reasoning: "max",
        skipped: ["anthropic-subscription/claude-opus-5-5"],
      },
    })
    expect(appliedContent(pi)).toContain("moonshotai/kimi-k3 max")
    expect(appliedContent(pi)).toContain("skipped: anthropic-subscription/claude-opus-5-5")
    expect(existsSync(join(agentDir, "settings.json"))).toBe(false)
  })

  test("#given daily-heavy #when the session starts #then fable xhigh is applied", async () => {
    const { pi, start } = harness({ model_profile: "daily-heavy" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([FABLE])
    expect(pi.sessionThinkingLevels).toEqual(["xhigh"])
    expect(appliedContent(pi)).toContain('"daily-heavy" (Daily · Heavy)')
    expect(appliedContent(pi)).toContain("anthropic/claude-fable-5-1 xhigh")
  })

  test("#given geeky-normal with only Copilot GPT-5.6 Sol #when the session starts #then gpt-5.6-sol medium is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [SOL_56_COPILOT, SOL, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SOL_56_COPILOT])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(appliedContent(pi)).toContain("github-copilot/gpt-5.6-sol medium")
  })

  test("#given geeky-heavy #when the session starts #then astra xhigh is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-heavy" }, [ASTRA, SOL_FAST])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([ASTRA])
    expect(pi.sessionThinkingLevels).toEqual(["xhigh"])
    expect(appliedContent(pi)).toContain("chatgpt-subscription/gpt-6-astra xhigh")
  })

  test("#given a literal provider/model #when the session starts #then that pin is applied for the session", async () => {
    const { pi, start } = harness({ model_profile: "anthropic/claude-opus-5-5" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      content: 'OmO Native: model profile "anthropic/claude-opus-5-5" selected anthropic/claude-opus-5-5; mid-session fallback follows senpi\'s retry chains',
    })
  })

  test("#given a lane with no available rung #when the session starts #then no model call and an unavailable notice that names the registry", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" }, [UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE, display: true })
    expect(appliedContent(pi)).toContain('"daily-normal" (Daily · Normal)')
    expect(appliedContent(pi)).toContain("model registry")
    expect(appliedContent(pi)).toContain("anthropic-subscription/claude-opus-5-5")
    expect(appliedContent(pi)).toContain("kimi-k3")
    expect(appliedContent(pi).toLowerCase()).not.toContain("connected")
  })

  test("#given an unknown profile name #when the session starts #then the resolver's diagnostic is emitted and nothing is applied", async () => {
    const { pi, start } = harness({ model_profile: "turbo" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_UNKNOWN_TYPE,
      content: 'OmO Native: model_profile "turbo" is not defined; known profiles: daily-heavy, daily-normal, geeky-heavy, geeky-normal, recommended',
    })
  })

  test("#given retired capable or deep-work ids #when the session starts #then they are unknown", async () => {
    const { pi, start } = harness({ model_profile: "capable" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNKNOWN_TYPE })
    expect(appliedContent(pi)).toContain('model_profile "capable" is not defined')
    expect(appliedContent(pi)).toContain("daily-normal")
    expect(appliedContent(pi)).not.toContain("capable,")
  })

  test("#given a user overlay of geeky-normal with an openai model #when the session starts #then that provider and reasoning apply without merging builtin rungs", async () => {
    const office: FakeModel = { provider: "openai", id: "gpt-6-sol" }
    const { pi, start } = harness(
      {
        model_profile: "geeky-normal",
        model_profiles: {
          "geeky-normal": { display_name: "Office GPT", models: [{ model: "openai/gpt-6-sol", reasoning: "high" }] },
        },
      },
      [office, SOL_FAST],
    )

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([office])
    expect(pi.sessionThinkingLevels).toEqual(["high"])
    expect(appliedContent(pi)).toContain('"geeky-normal" (Office GPT)')
    expect(appliedContent(pi)).toContain("openai/gpt-6-sol high")
    expect(appliedContent(pi)).not.toContain("gpt-6-sol-fast")
  })

  test("#given a custom user profile #when the session starts #then that chain is applied", async () => {
    const { pi, start } = harness(
      {
        model_profile: "night-shift",
        model_profiles: { "night-shift": { display_name: "Night shift", models: ["moonshotai/kimi-k3"] } },
      },
      [KIMI],
    )

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([KIMI])
    expect(appliedContent(pi)).toContain('"night-shift" (Night shift)')
  })

  test("#given a resumed session #when session_start fires #then the profile is not applied", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start({ reason: "resume", initialModelProvenance: "settings" })
    await start({ reason: "fork", initialModelProvenance: "settings" })
    await start({ reason: "reload" })

    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toEqual([])
  })

  test("#given a --model flag or a scoped model #when session_start fires #then the profile yields to it", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start({ reason: "startup", initialModelProvenance: "cli" })
    await start({ reason: "new", initialModelProvenance: "scoped" })

    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toEqual([])
  })

  test("#given a session_start that carries no provenance (senpi omits it on a --model run) #when it fires #then the profile does not touch the model", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start({ reason: "startup" })

    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toEqual([])
  })

  test("#given two session_start events for one session id #when both fire #then the model is applied once", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start(STARTUP, "session-1")
    await start({ reason: "new", initialModelProvenance: "settings" }, "session-1")

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.messages).toHaveLength(1)
  })

  test("#given a new session id after startup #when session_start fires again #then the profile applies to the new session too", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start(STARTUP, "session-1")
    await start({ reason: "new", initialModelProvenance: "settings" }, "session-2")

    expect(pi.sessionModels).toEqual([OPUS, OPUS])
  })

  test("#given unset and a stored Anthropic login whose refresh is rejected #when a desktop session starts #then the next rung with working credentials is applied and the notice points at provider settings", async () => {
    const probe = authProbe({ dead: ["anthropic"] })
    const { pi, logs, start } = harness({}, [OPUS, FABLE, GLM], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(probe.calls).toEqual(["anthropic", "zai", "zai/glm-5.3"])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE })
    const details = pi.messages[0]?.message["details"] as Record<string, unknown>
    expect(details).toMatchObject({ profile: "recommended", model: "zai/glm-5.3", reasoning: "max" })
    expect(details["authFailed"]).toEqual([{ provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" }])
    expect(appliedContent(pi)).toContain("re-authenticate anthropic in Provider authentication settings")
    expect(appliedContent(pi)).not.toContain("/login")
    expect(appliedContent(pi)).not.toContain(PRIVATE_MARKER)
    expect(JSON.stringify(pi.messages[0]?.message)).not.toContain(PRIVATE_MARKER)
    expect(logs.some((line) => line.startsWith("warn:") && line.includes("skipped anthropic/claude-opus-5-5"))).toBe(true)
    expect(logs.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
  })

  test("#given a rejected refresh #when a headless session starts #then the notice names the interactive login instead of a desktop setting", async () => {
    const probe = authProbe({ dead: ["anthropic"] })
    const { pi, start } = harness({}, [OPUS, GLM], probe.getAuth)

    await start(STARTUP, "session-print", "print")

    expect(pi.sessionModels).toEqual([GLM])
    expect(appliedContent(pi)).toContain("/login anthropic")
    expect(appliedContent(pi)).not.toContain("Provider authentication settings")
  })

  test("#given two distinct providers whose refreshes are rejected ahead of a healthy one #when the session starts #then both are skipped and the third is applied", async () => {
    const probe = authProbe({ dead: ["anthropic", "moonshotai"] })
    const { pi, start } = harness({}, [OPUS, KIMI, GLM], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(probe.calls).toEqual(["anthropic", "moonshotai", "zai", "zai/glm-5.3"])
    expect(pi.messages[0]?.message["details"]).toMatchObject({
      model: "zai/glm-5.3",
      authFailed: [
        { provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" },
        { provider: "moonshotai", model: "kimi-k3", reason: "refresh" },
      ],
    })
    expect(appliedContent(pi)).toContain("skipped anthropic:")
    expect(appliedContent(pi)).toContain("skipped moonshotai:")
  })

  test("#given every provider on the ladder fails to resolve credentials #when the session starts #then no model is applied and the notice lists each provider", async () => {
    const probe = authProbe({ dead: ["anthropic", "moonshotai"] })
    const { pi, start } = harness({}, [OPUS, FABLE, KIMI], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(probe.calls).toEqual(["anthropic", "moonshotai"])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
    expect(pi.messages[0]?.message["details"]).toEqual({
      profile: "recommended",
      authFailed: [
        { provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" },
        { provider: "moonshotai", model: "kimi-k3", reason: "refresh" },
      ],
    })
    expect(appliedContent(pi)).toContain("no model whose credentials resolve")
    expect(appliedContent(pi)).toContain("keeping senpi's default model")
    expect(appliedContent(pi)).not.toContain(PRIVATE_MARKER)
  })

  test("#given one model whose request configuration fails on a provider whose credentials resolve #when the session starts #then only that model is skipped and its sibling is applied", async () => {
    const probe = authProbe({ broken: ["anthropic/claude-opus-5-5"] })
    const { pi, logs, start } = harness({}, [OPUS, FABLE, GLM], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([FABLE])
    expect(pi.sessionThinkingLevels).toEqual(["xhigh"])
    expect(probe.calls).toEqual(["anthropic", "anthropic/claude-opus-5-5", "anthropic", "anthropic/claude-fable-5-1"])
    expect(pi.messages[0]?.message["details"]).toMatchObject({
      model: "anthropic/claude-fable-5-1",
      authFailed: [{ provider: "anthropic", model: "claude-opus-5-5", reason: "request" }],
    })
    expect(appliedContent(pi)).toContain("skipped anthropic/claude-opus-5-5: its request configuration did not resolve")
    expect(appliedContent(pi)).not.toContain("re-authenticate")
    expect(appliedContent(pi)).not.toContain(PRIVATE_MARKER)
    expect(logs.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
  })

  test("#given a credential pool whose flat account is expired but a sibling account resolves #when the session starts #then the provider stays eligible through the healthy slot", async () => {
    const probe = authProbe({ deadSlots: ["anthropic@expired"] })
    const { pi, start } = harness({}, [OPUS, GLM], probe.getAuth, {
      anthropic: { accounts: [{ name: "expired" }, { name: "healthy" }] },
    })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(probe.calls).toEqual(["anthropic@expired", "anthropic@healthy", "anthropic/claude-opus-5-5@healthy"])
    expect(pi.messages[0]?.message["details"]).not.toHaveProperty("authFailed")
  })

  test("#given a credential pool pinned to an account whose refresh is rejected #when the session starts #then only the pinned slot is probed and the provider is skipped", async () => {
    const probe = authProbe({ deadSlots: ["anthropic@expired"] })
    const { pi, start } = harness({}, [OPUS, GLM], probe.getAuth, {
      anthropic: { accounts: [{ name: "healthy" }, { name: "expired" }], pinned: "expired" },
    })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(probe.calls).toEqual(["anthropic@expired", "zai", "zai/glm-5.3"])
    expect(pi.messages[0]?.message["details"]).toMatchObject({
      authFailed: [{ provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" }],
    })
  })

  test("#given a pool whose provider disables rotation in models.json #when the session starts #then only the flat credential is probed, as the engine would use it", async () => {
    const probe = authProbe({ dead: ["anthropic"] })
    const { pi, agentDir, start } = harness({}, [OPUS, GLM], probe.getAuth, {
      anthropic: { accounts: [{ name: "expired" }, { name: "healthy" }] },
    })
    writeFileSync(join(agentDir, "models.json"), '{\n  // JSONC, as senpi reads it\n  "providers": { "anthropic": { "credentials": { "rotation": false } } }\n}\n')

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(probe.calls).toEqual(["anthropic", "zai", "zai/glm-5.3"])
    expect(pi.messages[0]?.message["details"]).toMatchObject({
      authFailed: [{ provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" }],
    })
  })

  test("#given rotation disabled for a different provider #when the session starts #then this provider's pool still rotates onto its healthy account", async () => {
    const probe = authProbe({ deadSlots: ["anthropic@expired"] })
    const { pi, agentDir, start } = harness({}, [OPUS, GLM], probe.getAuth, {
      anthropic: { accounts: [{ name: "expired" }, { name: "healthy" }] },
    })
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { zai: { credentials: { rotation: false } } } }))

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(probe.calls).toEqual(["anthropic@expired", "anthropic@healthy", "anthropic/claude-opus-5-5@healthy"])
  })

  test("#given a runtime API key set for a pooled provider #when the session starts #then rotation is off and only the flat credential is probed", async () => {
    const probe = authProbe({ dead: ["anthropic"] })
    const { pi, start } = harness(
      {},
      [OPUS, GLM],
      probe.getAuth,
      { anthropic: { accounts: [{ name: "expired" }, { name: "healthy" }] } },
      ["anthropic"],
    )

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(probe.calls).toEqual(["anthropic", "zai", "zai/glm-5.3"])
  })

  test("#given a lane whose first rung resolves credentials #when the session starts #then it is applied after one provider and one model probe", async () => {
    const probe = authProbe()
    const { pi, start } = harness({ model_profile: "daily-heavy" }, [FABLE, OPUS, KIMI], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([FABLE])
    expect(probe.calls).toEqual(["anthropic", "anthropic/claude-fable-5-1"])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE })
    expect(pi.messages[0]?.message["details"]).not.toHaveProperty("authFailed")
  })

  test("#given a literal provider/model pin with failing credentials #when the session starts #then the pin is applied unprobed", async () => {
    const probe = authProbe({ dead: ["anthropic"] })
    const { pi, start } = harness({ model_profile: "anthropic/claude-opus-5-5" }, [OPUS, GLM], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(probe.calls).toEqual([])
  })

  test("#given a host whose registry exposes no model runtime #when the session starts #then the plain walk applies the first listed rung", async () => {
    const { pi, start } = harness({}, [OPUS, GLM])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.messages[0]?.message["details"]).not.toHaveProperty("authFailed")
  })

  test("#given GLM-only registry and unset profile #when the session starts #then glm max is applied", async () => {
    const { pi, start } = harness({}, [GLM, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
  })

  test("#given other events #when they fire #then the component never touches the model", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await pi.dispatch("model_select", { model: KIMI }, {})
    await pi.dispatch("agent_end", {}, {})

    expect(pi.sessionModels).toEqual([])
    expect(pi.handlers.map(({ event }) => event)).toEqual(["session_start"])
    void start
  })
})

describe("model profile diagnostics through the composed default logger", () => {
  async function captureComposedOutput(debug: string | undefined) {
    const previous = process.env.OMO_DEBUG
    if (debug === undefined) delete process.env.OMO_DEBUG
    else process.env.OMO_DEBUG = debug
    const spies = ["info", "log", "error", "warn"].map((name) =>
      spyOn(console, name as "info" | "log" | "error" | "warn").mockImplementation(() => {}),
    )
    try {
      const pi = new FakeExtensionAPI()
      const probe = authProbe({ dead: ["anthropic"], broken: ["zai/glm-5.3"] })
      const config: OmoConfig = {
        model_profile: "qa",
        model_profiles: { qa: { models: ["anthropic/claude-opus-5-5", "zai/glm-5.3", "moonshotai/kimi-k3"] } },
      }
      await composeOmoSenpiExtension([
        createModelProfileComponent({ loadConfig: () => ({ config, diagnostics: [], layers: [], sources: [] }) }),
      ])(pi)
      await pi.dispatch(
        "session_start",
        { type: "session_start", ...STARTUP },
        {
          mode: "print",
          cwd: "/project",
          agentDir: mkdtempSync(join(tmpdir(), "omo-model-profile-composed-")),
          modelRegistry: registry([OPUS, GLM, KIMI], probe.getAuth),
          sessionManager: { getSessionId: () => "session-composed" },
        },
      )
      const lines = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")))
      return { pi, lines: lines.filter((line) => line.includes("model profile")) }
    } finally {
      for (const spy of spies) spy.mockRestore()
      if (previous === undefined) delete process.env.OMO_DEBUG
      else process.env.OMO_DEBUG = previous
    }
  }

  test("#given a rejected refresh and a failing model header #when the composed default logger reports them without OMO_DEBUG #then stderr names the skipped candidates but carries no raw error", async () => {
    const { pi, lines } = await captureComposedOutput(undefined)

    expect(pi.sessionModels).toEqual([KIMI])
    expect(lines.some((line) => line.includes("skipped anthropic/claude-opus-5-5") && line.includes("refresh"))).toBe(true)
    expect(lines.some((line) => line.includes("skipped zai/glm-5.3") && line.includes("request"))).toBe(true)
    expect(lines.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
    expect(JSON.stringify(pi.messages)).not.toContain(PRIVATE_MARKER)
  })

  test("#given OMO_DEBUG=1 #when the composed default logger reports the skipped candidates #then the detail line is present and still redacted", async () => {
    const { lines } = await captureComposedOutput("1")

    expect(lines.some((line) => line.includes("skipped anthropic/claude-opus-5-5: ModelsError"))).toBe(true)
    expect(lines.some((line) => line.includes("skipped zai/glm-5.3: Error") && line.includes("shell command: <redacted>"))).toBe(true)
    expect(lines.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
    expect(lines.some((line) => line.includes(SHORT_SECRET))).toBe(false)
  })
})
