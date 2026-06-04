const { describe, expect, test } = require("bun:test")

import type { VoterCandidate } from "../../shared/model-lineage"
import { resolveVoterCandidate } from "./voter-resolver"

describe("resolveVoterCandidate", () => {
  test("#given only a deprecated GPT fallback is available #when resolving a GPT voter #then it is not selected", () => {
    const deprecatedCodexModel = ["openai/gpt-5", ".3-codex"].join("")
    const candidate: VoterCandidate = {
      lineage: "gpt",
      entry: {
        providers: ["openai"],
        model: "gpt-5.5",
      },
    }

    const result = resolveVoterCandidate(
      candidate,
      new Set(["openai"]),
      new Set([deprecatedCodexModel]),
    )

    expect(result).toBeNull()
  })

  test("#given current GPT fallback is available #when resolving a GPT voter #then it selects the GPT-5.4-era fallback", () => {
    const candidate: VoterCandidate = {
      lineage: "gpt",
      entry: {
        providers: ["openai"],
        model: "gpt-5.5",
      },
    }

    const result = resolveVoterCandidate(
      candidate,
      new Set(["openai"]),
      new Set(["openai/gpt-5.4-mini"]),
    )

    expect(result).toEqual({
      lineage: "gpt",
      providerID: "openai",
      modelID: "gpt-5.4-mini",
      variant: undefined,
    })
  })
})
