/// <reference types="bun-types" />

import { describe, expect, spyOn, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { OAuthRefreshUnavailableError } from "@earendil-works/pi-ai/utils/oauth-refresh-error"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../../extension/compose"
import type { ComponentContext } from "../../extension/types"
import { convertToLlm } from "../../senpi-test-runtime"
import {
  createModelProfileComponent,
  MODEL_PROFILE_APPLIED_TYPE,
  MODEL_PROFILE_UNAVAILABLE_TYPE,
  MODEL_PROFILE_UNKNOWN_TYPE,
} from "./index"
import { ProfileExtensionAPI, recordedOutcome } from "./profile-outcome.test-support"
import { testTempDir } from "../../../test-support/temp-dir"

type FakeModel = { readonly provider: string; readonly id: string }

const FABLE: FakeModel = { provider: "anthropic", id: "claude-fable-5-1" }
const OPUS: FakeModel = { provider: "anthropic", id: "claude-opus-5-5" }
const KIMI: FakeModel = { provider: "moonshotai", id: "kimi-k3" }
const GLM: FakeModel = { provider: "zai", id: "glm-5.3" }
const SOL: FakeModel = { provider: "github-copilot", id: "gpt-6-sol" }
const SOL_56_COPILOT: FakeModel = { provider: "github-copilot", id: "gpt-5.6-sol" }
const SOL_61: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6.1-sol" }
const SOL_61_FAST: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6.1-sol-fast" }
const SOL_FAST: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6-sol-fast" }
const ASTRA: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6-astra" }
const API_ASTRA: FakeModel = { provider: "openai", id: "gpt-6-astra" }
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
  droppedFromFind: readonly string[] = [],
) {
  return {
    getAvailable: () => [...models],
    find: (provider: string, id: string) =>
      droppedFromFind.includes(`${provider}/${id}`)
        ? undefined
        : models.find((model) => model.provider === provider && model.id === id),
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

// senpi's credential-resolution failure that is not a refresh (for example a failing `!command` key).
function credentialsFailed(provider: string): Error {
  const error = new Error(`API key auth failed for provider ${provider}`)
  error.name = "ModelsError"
  return Object.assign(error, { code: "auth" })
}

// senpi's own error for a refresh that failed transiently (connection refused, timeout, 408/429/5xx):
// the real class, so the probe is tested against the marker senpi actually sets.
function refreshUnavailable(provider: string): Error {
  return new OAuthRefreshUnavailableError(provider, Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }))
}

type ProbeFailures = {
  readonly dead?: readonly string[]
  readonly deadSlots?: readonly string[]
  readonly broken?: readonly string[]
  /** Provider ids or `provider/model` selectors whose probe throws `throws(provider)` (`modelThrows` for a model, when set). */
  readonly custom?: {
    readonly targets: readonly string[]
    readonly throws: (provider: string) => unknown
    readonly modelThrows?: (provider: string) => unknown
  }
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
      if (failures.custom?.targets.includes(target)) throw failures.custom.throws(target)
      return { auth: { apiKey: "resolved" } }
    }
    calls.push(`${target.provider}/${target.id}${slot}`)
    if (failures.broken?.includes(`${target.provider}/${target.id}`)) throw requestConfigurationFailed(target)
    if (failures.custom?.targets.includes(`${target.provider}/${target.id}`)) throw (failures.custom.modelThrows ?? failures.custom.throws)(target.provider)
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

type Notice = { readonly message: string; readonly type: string | undefined }

function harness(
  config: OmoConfig,
  models: readonly FakeModel[] = [FABLE, OPUS, KIMI],
  auth?: FakeGetAuth,
  credentials?: Record<string, FakeCredential>,
  runtimeKeyProviders?: readonly string[],
  droppedFromFind?: readonly string[],
) {
  const pi = new ProfileExtensionAPI()
  const logs: string[] = []
  const notices: Notice[] = []
  const agentDir = testTempDir("omo-model-profile-")
  createModelProfileComponent({
    loadConfig: () => ({ config, diagnostics: [], layers: [], sources: [] }),
  }).register(pi, context(logs))
  const eventCtx = (sessionId = "session-1", mode = "rpc") => ({
    mode,
    cwd: "/project",
    agentDir,
    modelRegistry: registry(models, auth, credentials, runtimeKeyProviders, droppedFromFind),
    sessionManager: { getSessionId: () => sessionId },
    ui: { notify: (message: string, type?: string) => void notices.push({ message, type }) },
  })
  const start = (payload: Record<string, unknown>, sessionId?: string, mode?: string) =>
    pi.dispatch("session_start", { type: "session_start", ...payload }, eventCtx(sessionId, mode))
  return { pi, logs, notices, agentDir, start }
}

const STARTUP = { reason: "startup", initialModelProvenance: "settings" }

// What senpi sends the provider for the session's first prompt: the conversation the component left,
// then the prompt, through the engine's own converter, which gives the model every custom message as
// user text.
function firstRequest(pi: FakeExtensionAPI, prompt: string): unknown[] {
  const conversation = pi.messages.map(({ message }) => ({
    role: "custom" as const,
    customType: String(message["customType"]),
    content: typeof message["content"] === "string" ? message["content"] : "",
    display: message["display"] === true,
    details: message["details"],
    timestamp: 0,
  }))
  return convertToLlm([...conversation, { role: "user", content: prompt, timestamp: 1 }])
}

function appliedContent(pi: ProfileExtensionAPI): string {
  const content = recordedOutcome(pi)?.["content"]
  return typeof content === "string" ? content : ""
}

describe("createModelProfileComponent", () => {
  test("#given a TUI session #when it starts #then no profile applies, set or unset", async () => {
    for (const config of [{}, { model_profile: "daily-heavy" }, { model_profile: "anthropic/claude-fable-5-1" }] satisfies OmoConfig[]) {
      const { pi, start } = harness(config)

      await start(STARTUP, "session-tui", "tui")

      expect(pi.sessionModels).toEqual([])
      expect(pi.sessionThinkingLevels).toEqual([])
      expect(pi.entries).toHaveLength(0)
    }
  })

  test("#given model_profile unset #when the session starts #then Daily · Normal is applied", async () => {
    const { pi, notices, start } = harness({})

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      details: { profile: "daily-normal", model: "anthropic/claude-opus-5-5", reasoning: "medium", skipped: [] },
    })
    expect(appliedContent(pi)).toContain('"daily-normal" (Daily · Normal)')
    expect(appliedContent(pi)).toContain("anthropic/claude-opus-5-5 medium")
    expect(notices).toEqual([])
  })

  test("#given a blank model_profile #when the session starts #then Daily · Normal is applied", async () => {
    const { pi, start } = harness({ model_profile: "   " })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE, details: { profile: "daily-normal" } })
  })

  test("#given unset and Opus only through a gateway aggregator #when the session starts #then the gateway is skipped and kimi max is applied", async () => {
    const { pi, start } = harness({}, [GATEWAY_OPUS, CODING_KIMI])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([CODING_KIMI])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(recordedOutcome(pi)).toMatchObject({
      details: { profile: "daily-normal", model: "kimi-coding/kimi-k3", reasoning: "max" },
    })
  })

  test("#given unset and Opus on both the API and the Claude subscription #when the session starts #then the subscription lane wins", async () => {
    const { pi, start } = harness({}, [OPUS, SUBSCRIPTION_OPUS, KIMI])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SUBSCRIPTION_OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
  })

  test("#given unset with GPT-6.1 Sol and GPT-6 Sol connected beside GLM #when the session starts #then Daily · Normal's GLM rung is applied", async () => {
    const { pi, start } = harness({}, [SOL, SOL_61, GLM, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(recordedOutcome(pi)).toMatchObject({
      details: { profile: "daily-normal", model: "zai/glm-5.3", reasoning: "max" },
    })
  })

  test("#given unset with only the ChatGPT subscription #when the session starts #then the first lane that resolves, Obsessive · Normal, is applied", async () => {
    const { pi, start } = harness({}, [SOL_61, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SOL_61])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(recordedOutcome(pi)).toMatchObject({
      details: { profile: "geeky-normal", model: "chatgpt-subscription/gpt-6.1-sol", reasoning: "medium" },
    })
  })

  // Migration contract (#10029): a saved `recommended` starts the unset default, logged once, never unknown.
  test("#given a saved retired recommended model_profile #when two sessions start #then each applies the unset default and the retirement is logged once", async () => {
    const { pi, logs, start } = harness({ model_profile: "recommended" }, [SOL, SOL_61, GLM, UNRELATED])

    await start(STARTUP, "session-1")
    await start(STARTUP, "session-2")

    expect(pi.sessionModels).toEqual([GLM, GLM])
    expect(pi.entries.map((entry) => entry.customType)).toEqual([
      MODEL_PROFILE_APPLIED_TYPE,
      MODEL_PROFILE_APPLIED_TYPE,
    ])
    expect(recordedOutcome(pi)).toMatchObject({ details: { profile: "daily-normal", model: "zai/glm-5.3" } })
    expect(logs.filter((line) => line.includes('model_profile "recommended" is retired'))).toHaveLength(1)
  })

  test("#given the user's own model_profiles entry named recommended #when the session starts #then that profile applies", async () => {
    const { pi, logs, start } = harness(
      { model_profile: "recommended", model_profiles: { recommended: { models: ["zai/glm-5.3"] } } },
      [OPUS, GLM],
    )

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(recordedOutcome(pi)).toMatchObject({ details: { profile: "recommended", model: "zai/glm-5.3" } })
    expect(logs.some((line) => line.includes("is retired"))).toBe(false)
  })

  test("#given unset with only Copilot GPT-6 Sol and GLM #when the session starts #then Daily · Normal's GLM rung is applied", async () => {
    const { pi, start } = harness({}, [SOL, GLM, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(recordedOutcome(pi)).toMatchObject({
      details: { profile: "daily-normal", model: "zai/glm-5.3", reasoning: "max" },
    })
  })

  test("#given daily-normal and Opus only through a gateway #when the session starts #then the lane skips the gateway for its next listed rung", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" }, [GATEWAY_OPUS, CODING_KIMI])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([CODING_KIMI])
  })

  test("#given daily-normal and only a gateway serving its models #when the session starts #then the session model is kept with one unavailable notice", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" }, [GATEWAY_OPUS])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
  })

  test("#given daily-normal with only the third rung #when the session starts #then kimi max is applied and skipped rungs are named", async () => {
    const { pi, agentDir, start } = harness({ model_profile: "daily-normal" }, [KIMI, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([KIMI])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
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

  test("#given geeky-normal with GPT-6 Astra beside the Sol tiers #when the session starts #then gpt-6-astra medium is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [ASTRA, SOL_61, SOL_61_FAST, SOL_56_COPILOT, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([ASTRA])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(appliedContent(pi)).toContain("chatgpt-subscription/gpt-6-astra medium")
    expect(appliedContent(pi)).toContain("**NOT RECOMMENDED FOR WRITING OR EVERYDAY WORK.**")
  })

  test("#given geeky-normal without GPT-6 Astra, with GPT-6.1 Sol Fast and GPT-6.1 Sol connected #when the session starts #then gpt-6.1-sol-fast medium is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [SOL_61, SOL_61_FAST, SOL_56_COPILOT, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SOL_61_FAST])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(appliedContent(pi)).toContain("chatgpt-subscription/gpt-6.1-sol-fast medium")
  })

  test("#given geeky-normal with neither GPT-6 Astra nor the GPT-6.1 Sol Fast tier #when the session starts #then plain gpt-6.1-sol medium is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [SOL_56_COPILOT, SOL_61, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SOL_61])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(appliedContent(pi)).toContain("chatgpt-subscription/gpt-6.1-sol medium")
  })

  test("#given geeky-normal with only Copilot GPT-5.6 Sol, no Astra or 6.1 Sol #when the session starts #then gpt-5.6-sol medium is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [SOL_56_COPILOT, SOL, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SOL_56_COPILOT])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(appliedContent(pi)).toContain("github-copilot/gpt-5.6-sol medium")
  })

  test("#given geeky-heavy #when the session starts #then astra high is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-heavy" }, [ASTRA, SOL_FAST])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([ASTRA])
    expect(pi.sessionThinkingLevels).toEqual(["high"])
    expect(appliedContent(pi)).toContain("chatgpt-subscription/gpt-6-astra high")
  })

  test("#given a literal provider/model #when the session starts #then that pin is applied for the session", async () => {
    const { pi, start } = harness({ model_profile: "anthropic/claude-opus-5-5" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      content: 'OmO Native: model profile "anthropic/claude-opus-5-5" selected anthropic/claude-opus-5-5; mid-session fallback follows senpi\'s retry chains',
    })
  })

  test("#given a lane with no available rung #when the session starts #then no model call and an unavailable notice that names the registry", async () => {
    const { pi, notices, start } = harness({ model_profile: "daily-normal" }, [UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
    expect(notices).toEqual([{ message: appliedContent(pi), type: "warning" }])
    expect(appliedContent(pi)).toContain('"daily-normal" (Daily · Normal)')
    expect(appliedContent(pi)).toContain("model registry")
    expect(appliedContent(pi)).toContain("anthropic-subscription/claude-opus-5-5")
    expect(appliedContent(pi)).toContain("kimi-k3")
    expect(appliedContent(pi).toLowerCase()).not.toContain("connected")
  })

  // A profile outcome reaching the conversation reached the model ahead of the user's first prompt,
  // and one sent while that prompt streamed was delivered as a steer that cost a request of its own.
  test("#given any profile outcome #when the first prompt goes out #then the provider request carries the prompt alone", async () => {
    const outcomes: readonly (readonly [OmoConfig, readonly FakeModel[]])[] = [
      [{}, [UNRELATED]],
      [{ model_profile: "daily-normal" }, [UNRELATED]],
      [{ model_profile: "turbo" }, [OPUS]],
      [{}, [OPUS]],
    ]
    for (const [config, models] of outcomes) {
      const { pi, start } = harness(config, models)

      await start(STARTUP)

      expect(firstRequest(pi, "hello")).toEqual([{ role: "user", content: "hello", timestamp: 1 }])
      expect(pi.userMessages).toEqual([])
    }
  })

  test("#given only an unrelated custom model and no profile chosen #when a desktop session starts #then the fallback reaches the user as a quiet notice with the next step", async () => {
    const { notices, start } = harness({}, [UNRELATED])

    await start(STARTUP)

    expect(notices.map(({ type }) => type)).toEqual(["info"])
    expect(notices[0]?.message).toContain('"daily-normal" (Daily · Normal) has no available model')
    expect(notices[0]?.message).toContain("Provider authentication settings")
  })

  test("#given a chosen profile that no available model serves #when the session starts #then the user is warned with the step that host offers", async () => {
    for (const [mode, step] of [["rpc", "Provider authentication settings"], ["print", "/login"]] as const) {
      const { notices, start } = harness({ model_profile: "daily-normal" }, [UNRELATED])

      await start(STARTUP, `session-${mode}`, mode)

      expect(notices.map(({ type }) => type)).toEqual(["warning"])
      expect(notices[0]?.message).toContain(step)
    }
  })

  test("#given an unknown profile name #when the session starts #then the resolver's diagnostic is emitted and nothing is applied", async () => {
    const { pi, notices, start } = harness({ model_profile: "turbo" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({
      customType: MODEL_PROFILE_UNKNOWN_TYPE,
      content: 'OmO Native: model_profile "turbo" is not defined; known profiles: daily-heavy, daily-normal, geeky-heavy, geeky-normal',
    })
    expect(notices).toEqual([{ message: appliedContent(pi), type: "warning" }])
  })

  test("#given retired capable or deep-work ids #when the session starts #then they are unknown", async () => {
    const { pi, start } = harness({ model_profile: "capable" })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_UNKNOWN_TYPE })
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
    expect(pi.entries).toEqual([])
  })

  test("#given a --model flag or a scoped model #when session_start fires #then the profile yields to it", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start({ reason: "startup", initialModelProvenance: "cli" })
    await start({ reason: "new", initialModelProvenance: "scoped" })

    expect(pi.sessionModels).toEqual([])
    expect(pi.entries).toEqual([])
  })

  test("#given a session_start that carries no provenance (senpi omits it on a --model run) #when it fires #then the profile does not touch the model", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start({ reason: "startup" })

    expect(pi.sessionModels).toEqual([])
    expect(pi.entries).toEqual([])
  })

  test("#given two session_start events for one session id #when both fire #then the model is applied once", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start(STARTUP, "session-1")
    await start({ reason: "new", initialModelProvenance: "settings" }, "session-1")

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.entries).toHaveLength(1)
  })

  test("#given a new session id after startup #when session_start fires again #then the profile applies to the new session too", async () => {
    const { pi, start } = harness({ model_profile: "daily-normal" })

    await start(STARTUP, "session-1")
    await start({ reason: "new", initialModelProvenance: "settings" }, "session-2")

    expect(pi.sessionModels).toEqual([OPUS, OPUS])
  })

  test("#given unset and a stored Anthropic login whose refresh is rejected #when a desktop session starts #then the next rung with working credentials is applied and the notice points at provider settings", async () => {
    const probe = authProbe({ dead: ["anthropic"] })
    const harnessed = harness({}, [OPUS, FABLE, GLM], probe.getAuth)
    const { pi, logs, start } = harnessed

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(probe.calls).toEqual(["anthropic", "zai", "zai/glm-5.3"])
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE })
    const details = recordedOutcome(pi)?.["details"] as Record<string, unknown>
    expect(details).toMatchObject({ profile: "daily-normal", model: "zai/glm-5.3", reasoning: "max" })
    expect(details["authFailed"]).toEqual([{ provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" }])
    expect(appliedContent(pi)).toContain("re-authenticate anthropic in Provider authentication settings")
    expect(appliedContent(pi)).not.toContain("/login")
    expect(appliedContent(pi)).not.toContain(PRIVATE_MARKER)
    expect(JSON.stringify(pi.entries[0])).not.toContain(PRIVATE_MARKER)
    expect(logs.some((line) => line.startsWith("warn:") && line.includes("skipped anthropic/claude-opus-5-5"))).toBe(true)
    expect(logs.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
    // The user can act on the failed login, so it reaches them, not only the log (#11365 review).
    const { notices } = harnessed
    expect(notices).toEqual([{ message: appliedContent(pi), type: "warning" }])
  })

  test("#given a resolved model the registry no longer finds #when the session starts #then the user is warned with the next step (#11365 review)", async () => {
    // The resolver saw the model as available, but the registry lookup that sets it returns nothing.
    const { pi, notices, start } = harness({}, [OPUS, FABLE, KIMI], undefined, undefined, undefined, [
      "anthropic/claude-opus-5-5",
      "anthropic-subscription/claude-opus-5-5",
    ])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([])
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
    expect(notices.map(({ type }) => type)).toEqual(["warning"])
    expect(notices[0]?.message).toContain("no longer lists")
    expect(notices[0]?.message).toContain("Settings")
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
    expect(recordedOutcome(pi)?.["details"]).toMatchObject({
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
    expect(pi.entries).toHaveLength(1)
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
    expect(recordedOutcome(pi)?.["details"]).toEqual({
      profile: "daily-normal",
      authFailed: [
        { provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" },
        { provider: "moonshotai", model: "kimi-k3", reason: "refresh" },
      ],
    })
    expect(appliedContent(pi)).toContain("no model whose credentials resolve")
    expect(appliedContent(pi)).toContain("keeping senpi's default model")
    expect(appliedContent(pi)).not.toContain(PRIVATE_MARKER)
  })

  test("#given one model whose request configuration fails on a provider whose credentials resolve #when the session starts #then only that model is skipped and the lane's next rung is applied", async () => {
    const probe = authProbe({ broken: ["anthropic/claude-opus-5-5"] })
    const { pi, logs, start } = harness({}, [OPUS, FABLE, GLM], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(probe.calls).toEqual(["anthropic", "anthropic/claude-opus-5-5", "zai", "zai/glm-5.3"])
    expect(recordedOutcome(pi)?.["details"]).toMatchObject({
      model: "zai/glm-5.3",
      authFailed: [{ provider: "anthropic", model: "claude-opus-5-5", reason: "request" }],
    })
    expect(appliedContent(pi)).toContain("skipped anthropic/claude-opus-5-5: its request configuration did not resolve")
    expect(appliedContent(pi)).not.toContain("re-authenticate")
    expect(appliedContent(pi)).not.toContain(PRIVATE_MARKER)
    expect(logs.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
  })

  // A refresh that failed transiently says nothing about the sign-in: the first turn retries it, so
  // the subscription lane must keep the rung. Only a refused refresh moves the rung to the next
  // provider (here the metered OpenAI API lane).
  test.each([
    {
      kind: "a transient refresh failure on the provider probe",
      custom: { targets: ["chatgpt-subscription"], throws: refreshUnavailable },
      applied: ASTRA,
      authFailed: undefined,
    },
    {
      kind: "a transient refresh failure carried on the cause of a wrapping error",
      custom: {
        targets: ["chatgpt-subscription"],
        throws: (provider: string) => new Error("credential operation failed", { cause: refreshUnavailable(provider) }),
      },
      applied: ASTRA,
      authFailed: undefined,
    },
    {
      kind: "a transient refresh failure on the model probe",
      custom: { targets: ["chatgpt-subscription/gpt-6-astra"], throws: refreshUnavailable },
      applied: ASTRA,
      authFailed: undefined,
    },
    {
      kind: "a refused refresh",
      custom: { targets: ["chatgpt-subscription"], throws: refreshRejected },
      applied: API_ASTRA,
      authFailed: [{ provider: "chatgpt-subscription", model: "gpt-6-astra", reason: "refresh" }],
    },
    {
      // The provider stays eligible, but the model-scope check still runs: a model whose own header
      // configuration fails would fail the first turn, so only that candidate is skipped.
      kind: "a transient refresh failure on the provider probe and a failing model header",
      custom: { targets: ["chatgpt-subscription"], throws: refreshUnavailable },
      broken: ["chatgpt-subscription/gpt-6-astra"],
      applied: API_ASTRA,
      authFailed: [{ provider: "chatgpt-subscription", model: "gpt-6-astra", reason: "request" }],
    },
    {
      // The model probe re-runs the credential resolution after a transient provider probe; a
      // credentials-class failure there is provider-scope, not this model's request configuration.
      kind: "a transient refresh failure on the provider probe and a credentials failure on the model probe",
      custom: {
        targets: ["chatgpt-subscription", "chatgpt-subscription/gpt-6-astra"],
        throws: refreshUnavailable,
        modelThrows: credentialsFailed,
      },
      applied: API_ASTRA,
      authFailed: [{ provider: "chatgpt-subscription", model: "gpt-6-astra", reason: "credentials" }],
    },
  ])("#given geeky-normal with the subscription and the OpenAI API lane and $kind #when the session starts #then the expected lane serves GPT-6 Astra", async ({ custom, broken, applied, authFailed }) => {
    const probe = authProbe({ custom, broken })
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [ASTRA, API_ASTRA], probe.getAuth)

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([applied])
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE })
    const details = recordedOutcome(pi)?.["details"] as Record<string, unknown>
    expect(details["authFailed"]).toEqual(authFailed)
  })

  // The line says the first turn retries the refresh, so it is logged only while the refresh is still
  // unresolved: a model probe that resolves the credential itself means the retry already succeeded.
  test.each([
    { probe: "provider probe only (the model probe's refresh succeeds)", targets: ["chatgpt-subscription"], lines: 0 },
    { probe: "model probe", targets: ["chatgpt-subscription/gpt-6-astra"], lines: 1 },
    { probe: "provider and model probes", targets: ["chatgpt-subscription", "chatgpt-subscription/gpt-6-astra"], lines: 1 },
  ])("#given a transient refresh failure on the $probe #when the session keeps the subscription #then $lines warn line(s) name the kept candidate with only the error class and code", async ({ targets, lines }) => {
    const probe = authProbe({ custom: { targets, throws: refreshUnavailable } })
    const { logs, start } = harness({ model_profile: "geeky-normal" }, [ASTRA, API_ASTRA], probe.getAuth)

    await start(STARTUP)

    // The diagnosable fingerprint is the contract (candidate + error class/code + transport code),
    // not the sentence around it; the raw message must not leak.
    const kept = logs.filter((line) => line.startsWith("warn:") && line.includes("chatgpt-subscription/gpt-6-astra"))
    expect(kept).toHaveLength(lines)
    for (const line of kept) {
      expect(line).toContain("OAuthRefreshUnavailableError/oauth")
      expect(line).toContain("ECONNREFUSED")
    }
    expect(logs.some((line) => line.includes("connect failed"))).toBe(false)
  })

  test("#given a credential pool whose flat account is expired but a sibling account resolves #when the session starts #then the provider stays eligible through the healthy slot", async () => {
    const probe = authProbe({ deadSlots: ["anthropic@expired"] })
    const { pi, start } = harness({}, [OPUS, GLM], probe.getAuth, {
      anthropic: { accounts: [{ name: "expired" }, { name: "healthy" }] },
    })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(probe.calls).toEqual(["anthropic@expired", "anthropic@healthy", "anthropic/claude-opus-5-5@healthy"])
    expect(recordedOutcome(pi)?.["details"]).not.toHaveProperty("authFailed")
  })

  test("#given a credential pool pinned to an account whose refresh is rejected #when the session starts #then only the pinned slot is probed and the provider is skipped", async () => {
    const probe = authProbe({ deadSlots: ["anthropic@expired"] })
    const { pi, start } = harness({}, [OPUS, GLM], probe.getAuth, {
      anthropic: { accounts: [{ name: "healthy" }, { name: "expired" }], pinned: "expired" },
    })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([GLM])
    expect(probe.calls).toEqual(["anthropic@expired", "zai", "zai/glm-5.3"])
    expect(recordedOutcome(pi)?.["details"]).toMatchObject({
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
    expect(recordedOutcome(pi)?.["details"]).toMatchObject({
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
    expect(recordedOutcome(pi)).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE })
    expect(recordedOutcome(pi)?.["details"]).not.toHaveProperty("authFailed")
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
    expect(recordedOutcome(pi)?.["details"]).not.toHaveProperty("authFailed")
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
      const pi = new ProfileExtensionAPI()
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
          agentDir: testTempDir("omo-model-profile-composed-"),
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
    expect(JSON.stringify(pi.entries)).not.toContain(PRIVATE_MARKER)
  })

  test("#given OMO_DEBUG=1 #when the composed default logger reports the skipped candidates #then the detail line is present and still redacted", async () => {
    const { lines } = await captureComposedOutput("1")

    expect(lines.some((line) => line.includes("skipped anthropic/claude-opus-5-5: ModelsError"))).toBe(true)
    expect(lines.some((line) => line.includes("skipped zai/glm-5.3: Error") && line.includes("shell command: <redacted>"))).toBe(true)
    expect(lines.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
    expect(lines.some((line) => line.includes(SHORT_SECRET))).toBe(false)
  })
})
