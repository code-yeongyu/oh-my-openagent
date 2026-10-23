/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { testTempDir } from "../../../test-support/temp-dir"
import { createModelProfileComponent, MODEL_PROFILE_APPLIED_TYPE, MODEL_PROFILE_UNAVAILABLE_TYPE } from "./index"

type FakeModel = { readonly provider: string; readonly id: string }

const FABLE: FakeModel = { provider: "anthropic", id: "claude-fable-5-1" }
const OPUS: FakeModel = { provider: "anthropic", id: "claude-opus-5-5" }

async function startSession(config: OmoConfig, models: readonly FakeModel[]): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  createModelProfileComponent({ loadConfig: () => ({ config, diagnostics: [], layers: [], sources: [] }) }).register(pi, {
    config: { getFlag: () => undefined },
    logger: { error() {}, info() {}, warn() {} },
  })
  await pi.dispatch("session_start", { type: "session_start", reason: "startup", initialModelProvenance: "settings" }, {
    mode: "rpc",
    cwd: "/project",
    agentDir: testTempDir("omo-model-profile-exclude-"),
    modelRegistry: {
      getAvailable: () => [...models],
      find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
    },
    sessionManager: { getSessionId: () => "session-1" },
  })
  return pi
}

describe("model_profile with exclude_models", () => {
  test("#given a profile whose first rung is excluded #when the session starts #then the next rung is applied", async () => {
    // given
    const config: OmoConfig = {
      model_profile: "mine",
      model_profiles: { mine: { models: ["anthropic/claude-fable-5-1", "anthropic/claude-opus-5-5"] } },
      exclude_models: ["claude-fable-*"],
    }

    // when
    const pi = await startSession(config, [FABLE, OPUS])

    // then
    expect(pi.sessionModels).toEqual([OPUS])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE, details: { model: "anthropic/claude-opus-5-5" } })
  })

  test("#given a literal pin that is excluded #when the session starts #then it is not applied", async () => {
    // given
    const config: OmoConfig = { model_profile: "anthropic/claude-fable-5-1", exclude_models: ["claude-fable-*"] }

    // when
    const pi = await startSession(config, [FABLE, OPUS])

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
  })
})
