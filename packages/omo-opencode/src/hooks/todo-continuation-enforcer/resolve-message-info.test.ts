import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from "@oh-my-opencode/model-core";
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { resolveLatestMessageInfo } from "./resolve-message-info"
import type { MessageWithInfo } from "./types"

describe("resolveLatestMessageInfo", () => {
  test("given synthetic latest user info, skips it and resolves the prior real user info", async () => {
    // given
    const realModel = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }
    const syntheticModel = { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 }
    const messages: MessageWithInfo[] = [
      {
        info: { role: "user", agent: "sisyphus", model: realModel },
        parts: [{ type: "text", text: "real user task" }],
      },
      {
        info: { role: "user", agent: "atlas", model: syntheticModel },
        parts: [{ type: "text", text: "synthetic wake", synthetic: true }],
      },
    ]

    // when
    const result = await resolveLatestMessageInfo(
      unsafeTestValue({}),
      "ses_synthetic_latest_info",
      messages,
    )

    // then
    expect(result.resolvedInfo).toEqual({
      agent: "sisyphus",
      model: realModel,
      tools: undefined,
    })
  })

  test("given internally marked latest user info, skips it and resolves the prior real user info", async () => {
    // given
    const realModel = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }
    const internalModel = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_4 }
    const messages: MessageWithInfo[] = [
      {
        info: { role: "user", agent: "sisyphus", model: realModel },
        parts: [{ type: "text", text: "real user task" }],
      },
      {
        info: { role: "user", agent: "hephaestus", model: internalModel },
        parts: [{ type: "text", text: `internal wake\n${OMO_INTERNAL_INITIATOR_MARKER}` }],
      },
    ]

    // when
    const result = await resolveLatestMessageInfo(
      unsafeTestValue({}),
      "ses_internal_latest_info",
      messages,
    )

    // then
    expect(result.resolvedInfo).toEqual({
      agent: "sisyphus",
      model: realModel,
      tools: undefined,
    })
  })
})
