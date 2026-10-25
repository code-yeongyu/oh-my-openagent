/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getAtlasPromptSource } from "./atlas/agent"
import { getGptPromptIdentityKey } from "./gpt-prompt-identity"

describe("shared GPT prompt identities", () => {
  for (const [model, identityKey] of [
    ["openai/gpt-5.5", "gpt-5.5"],
    ["openai/gpt-5.6-sol", "gpt-5.6-sol"],
    ["github-copilot/gpt-6-astra", "gpt-6-astra"],
    ["openai/gpt-6-sol", "gpt-6-sol"],
    ["openai/gpt-6-sol-fast", "gpt-6-sol"],
    ["openai/gpt-6.1-sol", "gpt-6.1-sol"],
    ["chatgpt-subscription/gpt-6.1-sol-fast", "gpt-6.1-sol"],
    ["openrouter/openai/gpt-6.1-sol", "gpt-6.1-sol"],
    ["GPT-6.1-Sol", "gpt-6.1-sol"],
    ["gpt-6-1-sol", "gpt-6.1-sol"],
    ["venice/openai-gpt-61-sol", "gpt-6.1-sol"],
    ["openai/gpt-6-luna", "gpt-6-luna"],
    ["openai/gpt-6-luna-fast", "gpt-6-luna"],
    ["openai/gpt-6-astra-fast", "gpt-6-astra"],
    ["openai/gpt-6-lunar", "gpt-family"],
    ["openai/gpt-6.1-luna", "gpt-family"],
    ["openai/gpt-6-solar", "gpt-family"],
    ["openai/gpt-6.1", "gpt-family"],
    ["openai/gpt-611-sol", "gpt-family"],
  ] as const) {
    test(`selects the ${identityKey} identity contract`, () => {
      // given a supported GPT model routed through the shared prompt family

      // when its machine-consumed identity key is resolved
      const resolvedIdentityKey = getGptPromptIdentityKey(model)

      // then the structural contract identifies the routed model family exactly
      expect(resolvedIdentityKey).toBe(identityKey)
    })
  }

  for (const model of ["openai/gpt-5.5", "openai/gpt-5.6-sol", "github-copilot/gpt-6-astra"]) {
    test(`routes ${model} through the shared Atlas GPT prompt source`, () => {
      // given a supported GPT model

      // when the Atlas prompt source is resolved
      const source = getAtlasPromptSource(model)

      // then both versions use the model-neutral GPT-family source
      expect(source).toBe("gpt")
    })
  }
})
