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
const OPUS: FakeModel = { provider: "anthropic", id: "claude-opus-5" }
const KIMI: FakeModel = { provider: "moonshotai", id: "kimi-k3" }
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
  const eventCtx = (sessionId = "session-1") => ({
    cwd: "/project",
    agentDir,
    modelRegistry: registry(models),
    sessionManager: { getSessionId: () => sessionId },
  })
  const start = (payload: Record<string, unknown>, sessionId?: string) =>
    pi.dispatch("session_start", { type: "session_start", ...payload }, eventCtx(sessionId))
  return { pi, logs, agentDir, start }
}

const STARTUP = { reason: "startup", initialModelProvenance: "settings" }

describe("createModelProfileComponent", () => {
  test("#given model_profile unset #when the session starts #then nothing is applied and nothing is said", async () => {
    // given
    const { pi, logs, start } = harness({})

    // when
    await start(STARTUP)

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.messages).toEqual([])
    expect(logs).toEqual([])
  })

  test("#given a tier with an available rung #when the session starts #then exactly one setSessionModel, the rung's thinking level and one applied notice", async () => {
    // given
    const { pi, agentDir, start } = harness({ model_profile: "capable" }, [KIMI, UNRELATED])

    // when
    await start(STARTUP)

    // then
    expect(pi.sessionModels).toEqual([KIMI])
    expect(pi.sessionThinkingLevels).toEqual(["max"])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      display: true,
      details: { profile: "capable", model: "moonshotai/kimi-k3", skipped: ["anthropic/claude-fable-5-1", "anthropic/claude-opus-5"] },
    })
    expect(pi.messages[0]?.message["content"]).toBe(
      'omo-senpi: model profile "capable" selected moonshotai/kimi-k3 (skipped: anthropic/claude-fable-5-1, anthropic/claude-opus-5); mid-session fallback follows senpi\'s retry chains',
    )
    // The component never persists: no settings.json appears under the agent dir.
    expect(existsSync(join(agentDir, "settings.json"))).toBe(false)
  })

  test("#given a literal provider/model #when the session starts #then that pin is applied for the session", async () => {
    // given
    const { pi, start } = harness({ model_profile: "anthropic/claude-opus-5" })

    // when
    await start(STARTUP)

    // then
    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_APPLIED_TYPE,
      content: 'omo-senpi: model profile "anthropic/claude-opus-5" selected anthropic/claude-opus-5; mid-session fallback follows senpi\'s retry chains',
    })
  })

  test("#given a tier with no available rung #when the session starts #then no model call and one unavailable notice listing the chain", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" }, [UNRELATED])

    // when
    await start(STARTUP)

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.sessionThinkingLevels).toEqual([])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE, display: true })
    expect(pi.messages[0]?.message["content"]).toContain('model profile "capable"')
    expect(pi.messages[0]?.message["content"]).toContain("anthropic/claude-fable-5-1")
    expect(pi.messages[0]?.message["content"]).toContain("kimi-k3")
  })

  test("#given an unknown profile name #when the session starts #then the resolver's diagnostic is emitted and nothing is applied", async () => {
    // given
    const { pi, start } = harness({ model_profile: "turbo" })

    // when
    await start(STARTUP)

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message).toMatchObject({
      customType: MODEL_PROFILE_UNKNOWN_TYPE,
      content: 'omo-senpi: model_profile "turbo" is not defined; known profiles: capable, deep-work, simple-work',
    })
  })

  test("#given a resumed session #when session_start fires #then the profile is not applied", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" })

    // when
    await start({ reason: "resume", initialModelProvenance: "settings" })
    await start({ reason: "fork", initialModelProvenance: "settings" })
    await start({ reason: "reload" })

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toEqual([])
  })

  test("#given a --model flag or a scoped model #when session_start fires #then the profile yields to it", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" })

    // when
    await start({ reason: "startup", initialModelProvenance: "cli" })
    await start({ reason: "new", initialModelProvenance: "scoped" })

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toEqual([])
  })

  test("#given a session_start that carries no provenance (senpi omits it on a --model run) #when it fires #then the profile does not touch the model", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" })

    // when
    await start({ reason: "startup" })

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.messages).toEqual([])
  })

  test("#given two session_start events for one session id #when both fire #then the model is applied once", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" })

    // when
    await start(STARTUP, "session-1")
    await start({ reason: "new", initialModelProvenance: "settings" }, "session-1")

    // then
    expect(pi.sessionModels).toEqual([FABLE])
    expect(pi.messages).toHaveLength(1)
  })

  test("#given a new session id after startup #when session_start fires again #then the profile applies to the new session too", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" })

    // when
    await start(STARTUP, "session-1")
    await start({ reason: "new", initialModelProvenance: "settings" }, "session-2")

    // then
    expect(pi.sessionModels).toEqual([FABLE, FABLE])
  })

  test("#given other events #when they fire #then the component never touches the model", async () => {
    // given
    const { pi, start } = harness({ model_profile: "capable" })

    // when
    await pi.dispatch("model_select", { model: KIMI }, {})
    await pi.dispatch("agent_end", {}, {})

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.handlers.map(({ event }) => event)).toEqual(["session_start"])
    void start
  })
})
