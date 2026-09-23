/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
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
const GLM: FakeModel = { provider: "zai-coding-plan", id: "glm-5.3" }
const SOL: FakeModel = { provider: "github-copilot", id: "gpt-6-sol" }
const SOL_FAST: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6-sol-fast" }
const ASTRA: FakeModel = { provider: "chatgpt-subscription", id: "gpt-6-astra" }
const UNRELATED: FakeModel = { provider: "example", id: "nothing-in-any-chain" }

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => [...models],
    find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
  }
}

function context(logs: string[]): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: { error() {}, info: (message) => logs.push(`info:${message}`), warn: (message) => logs.push(`warn:${message}`) },
  }
}

function harness(config: OmoConfig, models: readonly FakeModel[] = [FABLE, OPUS, KIMI]) {
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
    modelRegistry: registry(models),
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

  test("#given model_profile unset #when the session starts #then Daily Normal is applied", async () => {
    const { pi, start } = harness({})

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      display: true,
      details: { profile: "daily-normal", model: "anthropic/claude-opus-5-5", reasoning: "medium", skipped: [] },
    })
    expect(appliedContent(pi)).toContain('"daily-normal" (Daily · Normal)')
    expect(appliedContent(pi)).toContain("anthropic/claude-opus-5-5 medium")
  })

  test("#given a blank model_profile #when the session starts #then Daily Normal is applied", async () => {
    const { pi, start } = harness({ model_profile: "   " })

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE, details: { profile: "daily-normal" } })
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

  test("#given geeky-normal with only Copilot Sol #when the session starts #then gpt-6-sol medium is applied", async () => {
    const { pi, start } = harness({ model_profile: "geeky-normal" }, [SOL, UNRELATED])

    await start(STARTUP)

    expect(pi.sessionModels).toEqual([SOL])
    expect(pi.sessionThinkingLevels).toEqual(["medium"])
    expect(appliedContent(pi)).toContain("github-copilot/gpt-6-sol medium")
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
      content: 'OmO Native: model_profile "turbo" is not defined; known profiles: daily-heavy, daily-normal, geeky-heavy, geeky-normal',
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
