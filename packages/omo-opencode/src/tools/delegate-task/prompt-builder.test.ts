declare const require: (name: string) => unknown
const { describe, test, expect } = require("bun:test") as {
  describe: (name: string, fn: () => void) => void
  test: (name: string, fn: () => void) => void
  expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toContain: (expected: string) => void
    toBeUndefined: () => void
    toBeDefined: () => void
    not: {
      toContain: (expected: string) => void
      toBeUndefined: () => void
    }
  }
}

import { buildSystemContent, isLocalBaseUrl, resolveProviderBaseURL } from "./prompt-builder"
import type { AvailableSkill, AvailableCategory } from "../../agents/dynamic-agent-prompt-builder"

describe("prompt-builder", () => {
  describe("buildSystemContent", () => {
    describe("#given non-plan agent with availableSkills", () => {
      test("#when availableSkills contains project-level skills #then system content omits skill list section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "git-master", description: "Git workflow automation", location: "plugin" },
          { name: "my-project-skill", description: "Project-specific deployment", location: "project" },
        ]
        const availableCategories: AvailableCategory[] = [
          { name: "quick", description: "Trivial tasks", model: "openai/gpt-5.6-luna-fast" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          availableSkills,
          availableCategories,
        })

        // then
        expect(result).toBeUndefined()
      })

      test("#when agent is explore #then system content omits skill list section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "review-work", description: "Review code quality", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "explore",
          availableSkills,
        })

        // then
        expect(result).toBeUndefined()
      })

      test("#when availableSkills is empty #then system content does not include available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = []

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          availableSkills,
          categoryPromptAppend: "some category context",
        })

        // then
        expect(result).toBeDefined()
        expect(result).not.toContain("available_skills")
      })
    })

    describe("#given plan agent with availableSkills", () => {
      test("#when availableSkills provided #then system content includes plan agent prepend with skills", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "git-master", description: "Git workflow automation", location: "plugin" },
        ]
        const availableCategories: AvailableCategory[] = [
          { name: "quick", description: "Trivial tasks", model: "openai/gpt-5.6-luna-fast" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "plan",
          availableSkills,
          availableCategories,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("git-master")
      })
    })

    describe("#given non-plan agent with agentsContext override", () => {
      test("#when agentsContext is provided #then it is preserved without appending skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "deploy-skill", description: "Deployment automation", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          agentsContext: "Custom agent context here",
          availableSkills,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("Custom agent context here")
        expect(result).not.toContain("deploy-skill")
      })
    })
  })
})

describe("buildSystemContent — free/local model detection via provider baseURL", () => {
  const CHARS_PER_TOKEN_ESTIMATE = 4
  const FREE_OR_LOCAL_TOKEN_CAP = 24_000
  const OVERSIZED_SKILL_CONTENT = "Skill payload line for truncation testing.\n".repeat(
    Math.ceil((FREE_OR_LOCAL_TOKEN_CAP * CHARS_PER_TOKEN_ESTIMATE * 2) / "Skill payload line for truncation testing.\n".length),
  )

  test("#given custom OpenAI-compatible provider with loopback baseURL #when building system content #then injected content is capped", () => {
    // given - issue repro: provider id 'omlx' matches none of the string allowlist branches
    const model = { providerID: "omlx", modelID: "qwen3" }

    // when
    const result = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model,
      providerBaseURL: "http://127.0.0.1:8000/v1",
    })

    // then
    expect(result).toBeDefined()
    expect(result?.includes("[TRUNCATED]")).toBe(true)
    expect((result ?? "").length < OVERSIZED_SKILL_CONTENT.length).toBe(true)
  })

  test("#given provider with private LAN baseURLs #when building system content #then injected content is capped", () => {
    // given
    const model = { providerID: "omlx", modelID: "qwen3" }

    // when
    const tenNetwork = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model,
      providerBaseURL: "http://10.0.0.5:8000/v1",
    })
    const privateNetwork = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model,
      providerBaseURL: "http://192.168.1.10:1234/v1",
    })

    // then
    expect(tenNetwork?.includes("[TRUNCATED]")).toBe(true)
    expect(privateNetwork?.includes("[TRUNCATED]")).toBe(true)
  })

  test("#given existing allowlisted providers without baseURL #when building system content #then injected content is still capped", () => {
    // given / when / then - each legacy detection branch must survive the new logic
    const ollama = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model: { providerID: "ollama", modelID: "qwen3" },
    })
    const lmstudio = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model: { providerID: "lmstudio", modelID: "qwen3" },
    })
    const localSubstring = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model: { providerID: "mylocal-proxy", modelID: "qwen3" },
    })
    const freeModel = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model: { providerID: "openai", modelID: "qwen-free" },
    })

    expect(ollama?.includes("[TRUNCATED]")).toBe(true)
    expect(lmstudio?.includes("[TRUNCATED]")).toBe(true)
    expect(localSubstring?.includes("[TRUNCATED]")).toBe(true)
    expect(freeModel?.includes("[TRUNCATED]")).toBe(true)
  })

  test("#given genuine cloud provider with remote baseURL #when building system content #then content stays uncapped", () => {
    // given
    const model = { providerID: "anthropic", modelID: "claude-opus-5" }

    // when
    const result = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model,
      providerBaseURL: "https://api.anthropic.com",
    })

    // then - no cap may apply to cloud models
    expect(result).toBe(OVERSIZED_SKILL_CONTENT)
  })

  test("#given unparseable baseURL #when building system content #then content stays uncapped", () => {
    // given
    const model = { providerID: "omlx", modelID: "qwen3" }

    // when
    const result = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model,
      providerBaseURL: "not-a-valid-url",
    })

    // then - conservative: never cap on an address we cannot parse
    expect(result).toBe(OVERSIZED_SKILL_CONTENT)
  })

  test("#given explicit maxPromptTokens #when building system content #then explicit limit wins over detection", () => {
    // given
    const model = { providerID: "anthropic", modelID: "claude-opus-5" }

    // when
    const result = buildSystemContent({
      skillContent: OVERSIZED_SKILL_CONTENT,
      model,
      providerBaseURL: "https://api.anthropic.com",
      maxPromptTokens: 100,
    })

    // then
    expect(result?.includes("[TRUNCATED]")).toBe(true)
    expect((result ?? "").length < OVERSIZED_SKILL_CONTENT.length).toBe(true)
  })
})

describe("buildSystemContent — nativeSkillInfos merging", () => {
  test("#given plan agent and a nativeSkill name not in availableSkills #when block is built #then native name appears", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "omo-skill", description: "From OMO disk", location: "project" },
    ]
    const nativeSkillInfos = [
      { name: "test-driven-development", description: "TDD discipline", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "plan",
      availableSkills,
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("omo-skill")
    expect(result).toContain("test-driven-development")
    expect(result).toContain("TDD discipline")
  })

  test("#given plan agent and a name in BOTH availableSkills AND nativeSkillInfos #when block is built #then OMO description wins", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "shared", description: "omo-version-of-shared", location: "project" },
    ]
    const nativeSkillInfos = [
      { name: "shared", description: "native-version-of-shared", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "plan",
      availableSkills,
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("omo-version-of-shared")
    expect(result).not.toContain("native-version-of-shared")
  })

  test("#given plan agent with empty availableSkills and a nativeSkillInfo #when block is built #then native skill renders", () => {
    // given
    const nativeSkillInfos = [
      { name: "brainstorming", description: "Use before any creative work", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "plan",
      availableSkills: [],
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("brainstorming")
  })

  test("#given non-plan agent and a nativeSkillInfo #when block is built #then native skill is omitted", () => {
    // given
    const nativeSkillInfos = [
      { name: "brainstorming", description: "Use before any creative work", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills: [],
      nativeSkillInfos,
    })

    // then
    expect(result).toBeUndefined()
  })
})

describe("isLocalBaseUrl", () => {
  test("#given loopback hostnames and IPv4 loopback addresses #when checked #then returns true", () => {
    // given / when / then
    expect(isLocalBaseUrl("http://localhost:8000/v1")).toBe(true)
    expect(isLocalBaseUrl("http://sub.localhost:8000/v1")).toBe(true)
    expect(isLocalBaseUrl("http://127.0.0.1:8000/v1")).toBe(true)
    expect(isLocalBaseUrl("http://127.8.8.8/v1")).toBe(true)
    expect(isLocalBaseUrl("http://[::1]:8000/v1")).toBe(true)
  })

  test("#given private or link-local LAN addresses #when checked #then returns true", () => {
    // given / when / then
    expect(isLocalBaseUrl("http://10.1.2.3:8000/v1")).toBe(true)
    expect(isLocalBaseUrl("http://172.16.0.1/v1")).toBe(true)
    expect(isLocalBaseUrl("http://172.31.255.255/v1")).toBe(true)
    expect(isLocalBaseUrl("http://192.168.0.15:1234/v1")).toBe(true)
    expect(isLocalBaseUrl("http://169.254.10.20/v1")).toBe(true)
    expect(isLocalBaseUrl("http://[fc00::1]:8000/v1")).toBe(true)
    expect(isLocalBaseUrl("http://[fe80::1]:8000/v1")).toBe(true)
  })

  test("#given public cloud endpoints #when checked #then returns false", () => {
    // given / when / then
    expect(isLocalBaseUrl("https://api.anthropic.com")).toBe(false)
    expect(isLocalBaseUrl("https://api.openai.com/v1")).toBe(false)
    expect(isLocalBaseUrl("http://8.8.8.8/v1")).toBe(false)
    expect(isLocalBaseUrl("http://172.32.0.1/v1")).toBe(false)
    expect(isLocalBaseUrl("http://example.local/v1")).toBe(false)
  })

  test("#given missing or unparseable input #when checked #then conservatively returns false", () => {
    // given / when / then
    expect(isLocalBaseUrl(undefined)).toBe(false)
    expect(isLocalBaseUrl("")).toBe(false)
    expect(isLocalBaseUrl("not-a-valid-url")).toBe(false)
  })
})

describe("resolveProviderBaseURL", () => {
  test("#given provider-level options.baseURL in config data #when resolved #then returns the baseURL", () => {
    // given
    const configData = {
      data: {
        provider: {
          omlx: { options: { baseURL: "http://127.0.0.1:8000/v1" } },
        },
      },
    }

    // when
    const result = resolveProviderBaseURL(configData, "omlx", "qwen3")

    // then
    expect(result).toBe("http://127.0.0.1:8000/v1")
  })

  test("#given model-level options.baseURL override #when resolved #then model-level wins over provider-level", () => {
    // given
    const configData = {
      data: {
        provider: {
          omlx: {
            options: { baseURL: "http://127.0.0.1:8000/v1" },
            models: { qwen3: { options: { baseURL: "http://192.168.1.5:9000/v1" } } },
          },
        },
      },
    }

    // when
    const result = resolveProviderBaseURL(configData, "omlx", "qwen3")

    // then
    expect(result).toBe("http://192.168.1.5:9000/v1")
  })

  test("#given unknown provider or malformed config shapes #when resolved #then returns undefined", () => {
    // given / when / then
    expect(resolveProviderBaseURL({ data: { provider: {} } }, "omlx")).toBeUndefined()
    expect(resolveProviderBaseURL({}, "omlx")).toBeUndefined()
    expect(resolveProviderBaseURL(null, "omlx")).toBeUndefined()
    expect(resolveProviderBaseURL(undefined, "omlx")).toBeUndefined()
    expect(resolveProviderBaseURL({ data: { provider: { omlx: { options: { baseURL: 42 } } } } }, "omlx")).toBeUndefined()
    expect(resolveProviderBaseURL({ data: { provider: { omlx: { options: { baseURL: "http://x" } } } } }, undefined)).toBeUndefined()
  })
})
