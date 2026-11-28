/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import { addIgnoredAgentOverrideWarnings } from "./ignored-agent-override-warnings"
import { clearConfigLoadErrors, getConfigLoadErrors } from "../shared/config-errors"
import type { OhMyOpenCodeConfig } from "../config"

beforeEach(() => {
  clearConfigLoadErrors()
})

describe("addIgnoredAgentOverrideWarnings", () => {
  test("warns when a non-built-in agent name carries a prompt", () => {
    const config: OhMyOpenCodeConfig = {
      agents: {
        "document-writer": { prompt: "You are a doc writer" },
      },
    }

    addIgnoredAgentOverrideWarnings(config)

    const errors = getConfigLoadErrors()
    expect(errors.length).toBe(1)
    expect(errors[0]?.path).toBe("agents.document-writer")
    expect(errors[0]?.error).toContain("prompt")
    expect(errors[0]?.error).toContain("not a built-in agent")
    expect(errors[0]?.error).toContain("agent/document-writer.md")
  })

  test("lists every ignored merge-path-only field", () => {
    const config: OhMyOpenCodeConfig = {
      agents: {
        "my-agent": { prompt: "p", prompt_append: "a", mode: "subagent" },
      },
    }

    addIgnoredAgentOverrideWarnings(config)

    const errors = getConfigLoadErrors()
    expect(errors.length).toBe(1)
    expect(errors[0]?.error).toContain("prompt")
    expect(errors[0]?.error).toContain("prompt_append")
    expect(errors[0]?.error).toContain("mode")
  })

  test("does not warn for built-in agent names", () => {
    const config: OhMyOpenCodeConfig = {
      agents: {
        explore: { prompt: "override", mode: "subagent" },
        atlas: { prompt_append: "x" },
      },
    }

    addIgnoredAgentOverrideWarnings(config)

    expect(getConfigLoadErrors()).toHaveLength(0)
  })

  test("does not warn when a custom agent only sets name-keyed fields", () => {
    const config: OhMyOpenCodeConfig = {
      agents: {
        "custom-router": {
          model: "github-copilot/gpt-5.5",
          fallback_models: ["github-copilot/gpt-5.6"],
          variant: "high",
        },
      },
    }

    addIgnoredAgentOverrideWarnings(config)

    expect(getConfigLoadErrors()).toHaveLength(0)
  })

  test("is a no-op when agents is undefined", () => {
    addIgnoredAgentOverrideWarnings({})
    expect(getConfigLoadErrors()).toHaveLength(0)
  })
})
