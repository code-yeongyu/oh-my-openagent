/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getAtlasPromptSource } from "./atlas/agent"
import { getGptPromptIdentityKey } from "./gpt-prompt-identity"

describe("shared GPT prompt identities", () => {
  for (const [model, identityKey] of [
    ["openai/gpt-5.5", "gpt-5.5"],
    ["openai/gpt-5.6-sol", "gpt-5.6-sol"],
  ] as const) {
    test(`selects the ${identityKey} identity contract`, () => {
      // given a supported GPT model routed through the shared prompt family

      // when its machine-consumed identity key is resolved
      const resolvedIdentityKey = getGptPromptIdentityKey(model)

      // then the structural contract identifies the routed model family exactly
      expect(resolvedIdentityKey).toBe(identityKey)
    })
  }

  for (const model of ["openai/gpt-5.5", "openai/gpt-5.6-sol"]) {
    test(`routes ${model} through the shared Atlas GPT prompt source`, () => {
      // given a supported GPT model

      // when the Atlas prompt source is resolved
      const source = getAtlasPromptSource(model)

      // then both versions use the model-neutral GPT-family source
      expect(source).toBe("gpt")
    })
  }
})
