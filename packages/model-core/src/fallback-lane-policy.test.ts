import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

// Default-lane policy guards: vercel stays out of every builtin fallback lane (same as
// openrouter/opencode-zen), the quotio-openai provider id is gone from the codebase, and any rung
// that lists the openai lane always carries openai-codex alongside it.

describe("builtin fallback lane policy", () => {
  test("no builtin category rung lists vercel as a provider", () => {
    for (const [name, requirement] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
      for (const rung of requirement.fallbackChain) {
        expect(rung.providers, `${name} rung ${rung.model} must not list vercel`).not.toContain("vercel")
      }
    }
  })

  test("no builtin category rung lists quotio-openai as a provider", () => {
    for (const [name, requirement] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
      for (const rung of requirement.fallbackChain) {
        expect(rung.providers, `${name} rung ${rung.model} must not list quotio-openai`).not.toContain("quotio-openai")
      }
    }
  })

  test("every category rung listing openai also lists openai-codex", () => {
    for (const [name, requirement] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
      for (const rung of requirement.fallbackChain) {
        if (rung.providers.includes("openai")) {
          expect(rung.providers, `${name} rung ${rung.model} lists openai without openai-codex`).toContain("openai-codex")
        }
      }
    }
  })

  test("no builtin agent rung lists vercel as a provider", () => {
    for (const [name, requirement] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
      for (const rung of requirement.fallbackChain) {
        expect(rung.providers, `${name} rung ${rung.model} must not list vercel`).not.toContain("vercel")
      }
    }
  })

  test("no builtin agent rung lists quotio-openai as a provider", () => {
    for (const [name, requirement] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
      for (const rung of requirement.fallbackChain) {
        expect(rung.providers, `${name} rung ${rung.model} must not list quotio-openai`).not.toContain("quotio-openai")
      }
    }
  })

  test("every agent rung listing openai also lists openai-codex", () => {
    for (const [name, requirement] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
      for (const rung of requirement.fallbackChain) {
        if (rung.providers.includes("openai")) {
          expect(rung.providers, `${name} rung ${rung.model} lists openai without openai-codex`).toContain("openai-codex")
        }
      }
    }
  })
})
