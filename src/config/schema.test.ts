import { describe, expect, test } from "bun:test"
import {
  AgentOverrideConfigSchema,
  BrowserAutomationConfigSchema,
  BrowserAutomationProviderSchema,
  BuiltinCategoryNameSchema,
  CategoryConfigSchema,
  ExperimentalConfigSchema,
  MatrixxConfigSchema,
} from "./schema"

describe("disabled_mcps schema", () => {
  test("should accept built-in MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "grep_app"],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "grep_app"])
    }
  })

  test("should accept custom MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["playwright", "sqlite", "custom-mcp"],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["playwright", "sqlite", "custom-mcp"])
    }
  })

  test("should accept mixed built-in and custom names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "playwright", "custom-server"],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "playwright", "custom-server"])
    }
  })

  test("should accept empty array", () => {
    // given
    const config = {
      disabled_mcps: [],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([])
    }
  })

  test("should reject non-string values", () => {
    // given
    const config = {
      disabled_mcps: [123, true, null],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept undefined (optional field)", () => {
    // given
    const config = {}

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toBeUndefined()
    }
  })

  test("should reject empty strings", () => {
    // given
    const config = {
      disabled_mcps: [""],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept MCP names with various naming patterns", () => {
    // given
    const config = {
      disabled_mcps: [
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ],
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ])
    }
  })
})

describe("AgentOverrideConfigSchema", () => {
  describe("category field", () => {
    test("accepts category as optional string", () => {
      // given
      const config = { category: "construct" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("construct")
      }
    })

    test("accepts config without category", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-string category", () => {
      // given
      const config = { category: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("variant field", () => {
    test("accepts variant as optional string", () => {
      // given
      const config = { variant: "high" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe("high")
      }
    })

    test("rejects non-string variant", () => {
      // given
      const config = { variant: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("skills field", () => {
    test("accepts skills as optional string array", () => {
      // given
      const config = { skills: ["frontend-ui-ux", "code-reviewer"] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual(["frontend-ui-ux", "code-reviewer"])
      }
    })

    test("accepts empty skills array", () => {
      // given
      const config = { skills: [] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual([])
      }
    })

    test("accepts config without skills", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-array skills", () => {
      // given
      const config = { skills: "frontend-ui-ux" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("still accepts model field (deprecated)", () => {
      // given
      const config = { model: "openai/gpt-5.2" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
      }
    })

    test("accepts both model and category (deprecated usage)", () => {
      // given - category should take precedence at runtime, but both should validate
      const config = { 
        model: "openai/gpt-5.2",
        category: "source"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
        expect(result.data.category).toBe("source")
      }
    })
  })

  describe("combined fields", () => {
    test("accepts category with skills", () => {
      // given
      const config = { 
        category: "construct",
        skills: ["frontend-ui-ux"]
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("construct")
        expect(result.data.skills).toEqual(["frontend-ui-ux"])
      }
    })

    test("accepts category with skills and other fields", () => {
      // given
      const config = { 
        category: "source",
        skills: ["code-reviewer"],
        temperature: 0.3,
        prompt_append: "Extra instructions"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("source")
        expect(result.data.skills).toEqual(["code-reviewer"])
        expect(result.data.temperature).toBe(0.3)
        expect(result.data.prompt_append).toBe("Extra instructions")
      }
    })
  })

  describe("fallbackChain field", () => {
    test("accepts fallbackChain with valid entries", () => {
      // #given
      const config = {
        fallbackChain: [
          { providers: ["anthropic", "opencode"], model: "claude-opus-4-6", variant: "max" },
          { providers: ["openai"], model: "gpt-5.2" },
        ],
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.fallbackChain).toHaveLength(2)
        expect(result.data.fallbackChain?.[0].providers).toEqual(["anthropic", "opencode"])
        expect(result.data.fallbackChain?.[0].model).toBe("claude-opus-4-6")
        expect(result.data.fallbackChain?.[0].variant).toBe("max")
        expect(result.data.fallbackChain?.[1].variant).toBeUndefined()
      }
    })

    test("accepts config without fallbackChain", () => {
      // #given
      const config = { temperature: 0.5 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.fallbackChain).toBeUndefined()
      }
    })

    test("rejects fallbackChain entry missing providers", () => {
      // #given
      const config = {
        fallbackChain: [{ model: "claude-opus-4-6" }],
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })

    test("rejects fallbackChain entry missing model", () => {
      // #given
      const config = {
        fallbackChain: [{ providers: ["anthropic"] }],
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })

    test("accepts empty fallbackChain array", () => {
      // #given
      const config = { fallbackChain: [] }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.fallbackChain).toEqual([])
      }
    })
  })
})

describe("CategoryConfigSchema", () => {
  test("accepts variant as optional string", () => {
    // given
    const config = { model: "openai/gpt-5.2", variant: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("xhigh")
    }
  })

  test("accepts reasoningEffort as optional string with xhigh", () => {
    // given
    const config = { reasoningEffort: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reasoningEffort).toBe("xhigh")
    }
  })

  test("rejects non-string variant", () => {
    // given
    const config = { model: "openai/gpt-5.2", variant: 123 }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("BuiltinCategoryNameSchema", () => {
  test("accepts all builtin category names", () => {
    // given
    const categories = ["construct", "source", "deep-jack", "matrix-bend", "bullet-time", "blue-pill", "red-pill", "broadcast"]

    // when / #then
    for (const cat of categories) {
      const result = BuiltinCategoryNameSchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })
})

describe("Mouse agent override", () => {
  test("schema accepts agents['Mouse'] and retains the key after parsing", () => {
    // given
    const config = {
      agents: {
        "mouse": {
          model: "openai/gpt-5.2",
          temperature: 0.2,
        },
      },
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.mouse).toBeDefined()
      expect(result.data.agents?.mouse?.model).toBe("openai/gpt-5.2")
      expect(result.data.agents?.mouse?.temperature).toBe(0.2)
    }
  })

  test("schema accepts mouse with prompt_append", () => {
    // given
    const config = {
      agents: {
        "mouse": {
          prompt_append: "Additional instructions for morpheus-junior",
        },
      },
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.mouse?.prompt_append).toBe(
        "Additional instructions for morpheus-junior"
      )
    }
  })

  test("schema accepts mouse with tools override", () => {
    // given
    const config = {
      agents: {
        "mouse": {
          tools: {
            read: true,
            write: false,
          },
        },
      },
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.mouse?.tools).toEqual({
        read: true,
        write: false,
      })
    }
  })

  test("schema accepts lowercase agent names (morpheus, architect, oracle)", () => {
    // given
    const config = {
      agents: {
        morpheus: {
          temperature: 0.1,
        },
        architect: {
          temperature: 0.2,
        },
        oracle: {
          temperature: 0.3,
        },
      },
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.morpheus?.temperature).toBe(0.1)
      expect(result.data.agents?.architect?.temperature).toBe(0.2)
      expect(result.data.agents?.oracle?.temperature).toBe(0.3)
    }
  })

  test("schema accepts lowercase seraph and smith agent names", () => {
    // given
    const config = {
      agents: {
        seraph: {
          category: "source",
        },
        smith: {
          category: "quick",
        },
      },
    }

    // when
    const result = MatrixxConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.seraph?.category).toBe("source")
      expect(result.data.agents?.smith?.category).toBe("quick")
    }
  })
})

describe("BrowserAutomationProviderSchema", () => {
  test("accepts 'playwright' as valid provider", () => {
    // given
    const input = "playwright"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("playwright")
  })

  test("accepts 'agent-browser' as valid provider", () => {
    // given
    const input = "agent-browser"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("agent-browser")
  })

  test("rejects invalid provider", () => {
    // given
    const input = "invalid-provider"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("accepts 'playwright-cli' as valid provider", () => {
    // given
    const input = "playwright-cli"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("playwright-cli")
  })
})

describe("BrowserAutomationConfigSchema", () => {
  test("defaults provider to 'playwright' when not specified", () => {
    // given
    const input = {}

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("playwright")
  })

  test("accepts agent-browser provider", () => {
    // given
    const input = { provider: "agent-browser" }

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("agent-browser")
  })

  test("accepts playwright-cli provider in config", () => {
    // given
    const input = { provider: "playwright-cli" }

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("playwright-cli")
  })
})

describe("MatrixxConfigSchema - browser_automation_engine", () => {
  test("accepts browser_automation_engine config", () => {
    // given
    const input = {
      browser_automation_engine: {
        provider: "agent-browser",
      },
    }

    // when
    const result = MatrixxConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine?.provider).toBe("agent-browser")
  })

  test("accepts config without browser_automation_engine", () => {
    // given
    const input = {}

    // when
    const result = MatrixxConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine).toBeUndefined()
  })

  test("accepts browser_automation_engine with playwright-cli", () => {
    // given
    const input = { browser_automation_engine: { provider: "playwright-cli" } }

    // when
    const result = MatrixxConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine?.provider).toBe("playwright-cli")
  })
})

describe("ExperimentalConfigSchema feature flags", () => {
  test("accepts plugin_load_timeout_ms as number", () => {
    //#given
    const config = { plugin_load_timeout_ms: 5000 }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugin_load_timeout_ms).toBe(5000)
    }
  })

  test("rejects plugin_load_timeout_ms below 1000", () => {
    //#given
    const config = { plugin_load_timeout_ms: 500 }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts safe_hook_creation as boolean", () => {
    //#given
    const config = { safe_hook_creation: false }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.safe_hook_creation).toBe(false)
    }
  })

  test("both fields are optional", () => {
    //#given
    const config = {}

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugin_load_timeout_ms).toBeUndefined()
      expect(result.data.safe_hook_creation).toBeUndefined()
    }
  })

  test("accepts hashline_edit as true", () => {
    //#given
    const config = { hashline_edit: true }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hashline_edit).toBe(true)
    }
  })

  test("accepts hashline_edit as false", () => {
    //#given
    const config = { hashline_edit: false }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hashline_edit).toBe(false)
    }
  })

  test("hashline_edit is optional", () => {
    //#given
    const config = { safe_hook_creation: true }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hashline_edit).toBeUndefined()
    }
  })

  test("rejects non-boolean hashline_edit", () => {
    //#given
    const config = { hashline_edit: "true" }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})


describe("skills schema", () => {
  test("accepts skills.sources configuration", () => {
    //#given
    const config = {
      skills: {
        sources: [{ path: "skill/", recursive: true }],
      },
    }

    //#when
    const result = MatrixxConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })
})
