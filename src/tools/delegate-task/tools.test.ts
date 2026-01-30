import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, CATEGORY_DESCRIPTIONS, isPlanAgent, PLAN_AGENT_NAMES } from "./constants"
import { resolveCategoryConfig } from "./tools"
import type { CategoryConfig } from "../../config/schema"
import { __resetModelCache } from "../../shared/model-availability"
import { clearSkillCache } from "../../features/opencode-skill-loader/skill-content"
import { __setTimingConfig, __resetTimingConfig } from "./timing"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5"

describe("sisyphus-task", () => {
  let cacheSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    __resetModelCache()
    clearSkillCache()
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 50,
      STABILITY_POLLS_REQUIRED: 1,
      WAIT_FOR_SESSION_INTERVAL_MS: 10,
      WAIT_FOR_SESSION_TIMEOUT_MS: 1000,
      MAX_POLL_TIME_MS: 2000,
      SESSION_CONTINUATION_STABILITY_MS: 50,
    })
    cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic", "google", "openai"])
  })

  afterEach(() => {
    __resetTimingConfig()
    cacheSpy?.mockRestore()
  })

  describe("DEFAULT_CATEGORIES", () => {
    test("visual-engineering category has model config", () => {
      // #given
      const category = DEFAULT_CATEGORIES["visual-engineering"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBe("google/gemini-3-pro")
    })

    test("ultrabrain category has model and variant config", () => {
      // #given
      const category = DEFAULT_CATEGORIES["ultrabrain"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBe("openai/gpt-5.2-codex")
      expect(category.variant).toBe("xhigh")
    })

    test("deep category has model and variant config", () => {
      // #given
      const category = DEFAULT_CATEGORIES["deep"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBe("openai/gpt-5.2-codex")
      expect(category.variant).toBe("medium")
    })
  })

  describe("CATEGORY_PROMPT_APPENDS", () => {
    test("visual-engineering category has design-focused prompt", () => {
      // #given
      const promptAppend = CATEGORY_PROMPT_APPENDS["visual-engineering"]

      // #when / #then
      expect(promptAppend).toContain("VISUAL/UI")
      expect(promptAppend).toContain("Design-first")
    })

    test("ultrabrain category has deep logical reasoning prompt", () => {
      // #given
      const promptAppend = CATEGORY_PROMPT_APPENDS["ultrabrain"]

      // #when / #then
      expect(promptAppend).toContain("DEEP LOGICAL REASONING")
      expect(promptAppend).toContain("Strategic advisor")
    })

    test("deep category has goal-oriented autonomous prompt", () => {
      // #given
      const promptAppend = CATEGORY_PROMPT_APPENDS["deep"]

      // #when / #then
      expect(promptAppend).toContain("GOAL-ORIENTED")
      expect(promptAppend).toContain("autonomous")
    })
  })

  describe("CATEGORY_DESCRIPTIONS", () => {
    test("has description for all default categories", () => {
      // #given
      const defaultCategoryNames = Object.keys(DEFAULT_CATEGORIES)

      // #when / #then
      for (const name of defaultCategoryNames) {
        expect(CATEGORY_DESCRIPTIONS[name]).toBeDefined()
        expect(CATEGORY_DESCRIPTIONS[name].length).toBeGreaterThan(0)
      }
    })

    test("unspecified-high category exists and has description", () => {
      // #given / #when
      const description = CATEGORY_DESCRIPTIONS["unspecified-high"]

      // #then
      expect(description).toBeDefined()
      expect(description).toContain("high effort")
    })
  })

  describe("isPlanAgent", () => {
    test("returns true for 'plan'", () => {
      // #given / #when
      const result = isPlanAgent("plan")

      // #then
      expect(result).toBe(true)
    })

    test("returns true for 'prometheus'", () => {
      // #given / #when
      const result = isPlanAgent("prometheus")

      // #then
      expect(result).toBe(true)
    })

    test("returns true for 'planner'", () => {
      // #given / #when
      const result = isPlanAgent("planner")

      // #then
      expect(result).toBe(true)
    })

    test("returns true for case-insensitive match 'PLAN'", () => {
      // #given / #when
      const result = isPlanAgent("PLAN")

      // #then
      expect(result).toBe(true)
    })

    test("returns true for case-insensitive match 'Prometheus'", () => {
      // #given / #when
      const result = isPlanAgent("Prometheus")

      // #then
      expect(result).toBe(true)
    })

    test("returns false for 'oracle'", () => {
      // #given / #when
      const result = isPlanAgent("oracle")

      // #then
      expect(result).toBe(false)
    })

    test("returns false for 'explore'", () => {
      // #given / #when
      const result = isPlanAgent("explore")

      // #then
      expect(result).toBe(false)
    })

    test("returns false for undefined", () => {
      // #given / #when
      const result = isPlanAgent(undefined)

      // #then
      expect(result).toBe(false)
    })

    test("returns false for empty string", () => {
      // #given / #when
      const result = isPlanAgent("")

      // #then
      expect(result).toBe(false)
    })

    test("PLAN_AGENT_NAMES contains expected values", () => {
      // #given / #when / #then
      expect(PLAN_AGENT_NAMES).toContain("plan")
      expect(PLAN_AGENT_NAMES).toContain("prometheus")
      expect(PLAN_AGENT_NAMES).toContain("planner")
    })
  })

  describe("category delegation config validation", () => {
    test("proceeds without error when systemDefaultModel is undefined", async () => {
      // #given a mock client with no model in config
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({ id: "task-123" }) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({}) }, // No model configured
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when delegating with a category
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: true,
          load_skills: [],
        },
        toolContext
      )
      
      // #then proceeds without error - uses fallback chain
      expect(result).not.toContain("oh-my-opencode requires a default model")
    })

    test("returns clear error when no model can be resolved", async () => {
      // #given - custom category with no model, no systemDefaultModel, no available models
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({ id: "task-123" }) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({}) }, // No model configured
        model: { list: async () => [] }, // No available models
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }
      
      // Custom category with no model defined
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
        userCategories: {
          "custom-no-model": { temperature: 0.5 }, // No model field
        },
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when delegating with a custom category that has no model
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "custom-no-model",
          run_in_background: true,
          load_skills: [],
        },
        toolContext
      )
      
      // #then returns clear error message with configuration guidance
      expect(result).toContain("Model not configured")
      expect(result).toContain("custom-no-model")
      expect(result).toContain("Configure in one of")
    })
  })

  describe("resolveCategoryConfig", () => {
    test("returns null for unknown category without user config", () => {
      // #given
      const categoryName = "unknown-category"

      // #when
      const result = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).toBeNull()
    })

    test("blocks requiresModel when availability is known and missing the required model", () => {
      // #given
      const categoryName = "deep"
      const availableModels = new Set<string>(["anthropic/claude-opus-4-5"])

      // #when
      const result = resolveCategoryConfig(categoryName, {
        systemDefaultModel: SYSTEM_DEFAULT_MODEL,
        availableModels,
      })

      // #then
      expect(result).toBeNull()
    })

    test("blocks requiresModel when availability is empty", () => {
      // #given
      const categoryName = "deep"
      const availableModels = new Set<string>()

      // #when
      const result = resolveCategoryConfig(categoryName, {
        systemDefaultModel: SYSTEM_DEFAULT_MODEL,
        availableModels,
      })

      // #then
      expect(result).toBeNull()
    })

    test("returns default model from DEFAULT_CATEGORIES for builtin category", () => {
      // #given
      const categoryName = "visual-engineering"

      // #when
      const result = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("google/gemini-3-pro")
      expect(result!.promptAppend).toContain("VISUAL/UI")
    })

    test("user config overrides systemDefaultModel", () => {
      // #given
      const categoryName = "visual-engineering"
      const userCategories = {
        "visual-engineering": { model: "anthropic/claude-opus-4-5" },
      }

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("anthropic/claude-opus-4-5")
    })

    test("user prompt_append is appended to default", () => {
      // #given
      const categoryName = "visual-engineering"
      const userCategories = {
        "visual-engineering": {
          model: "google/gemini-3-pro",
          prompt_append: "Custom instructions here",
        },
      }

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.promptAppend).toContain("VISUAL/UI")
      expect(result!.promptAppend).toContain("Custom instructions here")
    })

    test("user can define custom category", () => {
      // #given
      const categoryName = "my-custom"
      const userCategories = {
        "my-custom": {
          model: "openai/gpt-5.2",
          temperature: 0.5,
          prompt_append: "You are a custom agent",
        },
      }

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("openai/gpt-5.2")
      expect(result!.config.temperature).toBe(0.5)
      expect(result!.promptAppend).toBe("You are a custom agent")
    })

    test("user category overrides temperature", () => {
      // #given
      const categoryName = "visual-engineering"
      const userCategories = {
        "visual-engineering": {
          model: "google/gemini-3-pro",
          temperature: 0.3,
        },
      }

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.temperature).toBe(0.3)
    })

    test("category built-in model takes precedence over inheritedModel", () => {
      // #given - builtin category with its own model, parent model also provided
      const categoryName = "visual-engineering"
      const inheritedModel = "cliproxy/claude-opus-4-5"

      // #when
      const result = resolveCategoryConfig(categoryName, { inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then - category's built-in model wins over inheritedModel
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("google/gemini-3-pro")
    })

    test("systemDefaultModel is used as fallback when custom category has no model", () => {
      // #given - custom category with no model defined
      const categoryName = "my-custom-no-model"
      const userCategories = { "my-custom-no-model": { temperature: 0.5 } } as unknown as Record<string, CategoryConfig>
      const inheritedModel = "cliproxy/claude-opus-4-5"

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then - systemDefaultModel is used since custom category has no built-in model
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe(SYSTEM_DEFAULT_MODEL)
    })

    test("user model takes precedence over inheritedModel", () => {
      // #given
      const categoryName = "visual-engineering"
      const userCategories = {
        "visual-engineering": { model: "my-provider/my-model" },
      }
      const inheritedModel = "cliproxy/claude-opus-4-5"

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("my-provider/my-model")
    })

    test("default model from category config is used when no user model and no inheritedModel", () => {
      // #given
      const categoryName = "visual-engineering"

      // #when
      const result = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("google/gemini-3-pro")
    })
  })

  describe("category variant", () => {
    test("passes variant to background model payload", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      let launchInput: any

      const mockManager = {
        launch: async (input: any) => {
          launchInput = input
          return {
            id: "task-variant",
            sessionID: "session-variant",
            description: "Variant task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }

      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
        userCategories: {
          ultrabrain: { model: "openai/gpt-5.2", variant: "xhigh" },
        },
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when
      await tool.execute(
        {
          description: "Variant task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: true,
          load_skills: ["git-master"],
        },
        toolContext
      )

      // #then
      expect(launchInput.model).toEqual({
        providerID: "openai",
        modelID: "gpt-5.2",
        variant: "xhigh",
      })
    })

    test("DEFAULT_CATEGORIES variant passes to background WITHOUT userCategories", async () => {
      // #given - NO userCategories, testing DEFAULT_CATEGORIES only
      const { createDelegateTask } = require("./tools")
      let launchInput: any

      const mockManager = {
        launch: async (input: any) => {
          launchInput = input
          return {
            id: "task-default-variant",
            sessionID: "session-default-variant",
            description: "Default variant task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }

      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        model: { list: async () => [{ id: "anthropic/claude-opus-4-5" }] },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }

      // NO userCategories - must use DEFAULT_CATEGORIES
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - unspecified-high has variant: "max" in DEFAULT_CATEGORIES
      await tool.execute(
        {
          description: "Test unspecified-high default variant",
          prompt: "Do something",
          category: "unspecified-high",
          run_in_background: true,
          load_skills: ["git-master"],
        },
        toolContext
      )

      // #then - variant MUST be "max" from DEFAULT_CATEGORIES
      expect(launchInput.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-opus-4-5",
        variant: "max",
      })
    })

    test("DEFAULT_CATEGORIES variant passes to sync session.prompt WITHOUT userCategories", async () => {
      // #given - NO userCategories, testing DEFAULT_CATEGORIES for sync mode
      const { createDelegateTask } = require("./tools")
      let promptBody: any

      const mockManager = { launch: async () => ({}) }

      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        model: { list: async () => [{ id: "anthropic/claude-opus-4-5" }] },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_sync_default_variant" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }]
          }),
          status: async () => ({ data: { "ses_sync_default_variant": { type: "idle" } } }),
        },
      }

      // NO userCategories - must use DEFAULT_CATEGORIES
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - unspecified-high has variant: "max" in DEFAULT_CATEGORIES
      await tool.execute(
        {
          description: "Test unspecified-high sync variant",
          prompt: "Do something",
          category: "unspecified-high",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )

      // #then - variant MUST be "max" from DEFAULT_CATEGORIES (passed as separate field)
      expect(promptBody.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-opus-4-5",
      })
      expect(promptBody.variant).toBe("max")
    }, { timeout: 20000 })
  })

  describe("skills parameter", () => {
    test("skills parameter is required - throws error when not provided", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - skills not provided (undefined)
      // #then - should throw error about missing skills
      await expect(tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
        },
        toolContext
      )).rejects.toThrow("IT IS HIGHLY RECOMMENDED")
    })

    test("null skills throws error", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - null passed
      // #then - should throw error about null
      await expect(tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: null,
        },
        toolContext
      )).rejects.toThrow("IT IS HIGHLY RECOMMENDED")
    })

    test("empty array [] is allowed and proceeds without skill content", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      let promptBody: any
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }]
          }),
          status: async () => ({ data: {} }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - empty array passed
      await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )
      
      // #then - should proceed without system content from skills
      expect(promptBody).toBeDefined()
    }, { timeout: 20000 })
  })

  describe("session_id with background parameter", () => {
  test("session_id with background=false should wait for result and return content", async () => {
    // Note: This test needs extended timeout because the implementation has MIN_STABILITY_TIME_MS = 5000
    // #given
    const { createDelegateTask } = require("./tools")
    
    const mockTask = {
      id: "task-123",
      sessionID: "ses_continue_test",
      description: "Continued task",
      agent: "explore",
      status: "running",
    }
    
    const mockManager = {
      resume: async () => mockTask,
      launch: async () => mockTask,
    }
    
    const mockClient = {
      session: {
        prompt: async () => ({ data: {} }),
        messages: async () => ({
          data: [
            {
              info: { role: "assistant", time: { created: Date.now() } },
              parts: [{ type: "text", text: "This is the continued task result" }],
            },
          ],
        }),
      },
      config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
      app: {
        agents: async () => ({ data: [] }),
      },
    }
    
    const tool = createDelegateTask({
      manager: mockManager,
      client: mockClient,
    })
    
    const toolContext = {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "sisyphus",
      abort: new AbortController().signal,
    }
    
    // #when
    const result = await tool.execute(
      {
        description: "Continue test",
        prompt: "Continue the task",
        session_id: "ses_continue_test",
        run_in_background: false,
        load_skills: ["git-master"],
      },
      toolContext
    )
    
    // #then - should contain actual result, not just "Background task continued"
    expect(result).toContain("This is the continued task result")
    expect(result).not.toContain("Background task continued")
  }, { timeout: 10000 })

  test("session_id with background=true should return immediately without waiting", async () => {
    // #given
    const { createDelegateTask } = require("./tools")
    
    const mockTask = {
      id: "task-456",
      sessionID: "ses_bg_continue",
      description: "Background continued task",
      agent: "explore",
      status: "running",
    }
    
    const mockManager = {
      resume: async () => mockTask,
    }
    
    const mockClient = {
      session: {
        prompt: async () => ({ data: {} }),
        messages: async () => ({
          data: [],
        }),
      },
      config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
    }
    
    const tool = createDelegateTask({
      manager: mockManager,
      client: mockClient,
    })
    
    const toolContext = {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "sisyphus",
      abort: new AbortController().signal,
    }
    
    // #when
    const result = await tool.execute(
      {
        description: "Continue bg test",
        prompt: "Continue in background",
        session_id: "ses_bg_continue",
        run_in_background: true,
        load_skills: ["git-master"],
      },
      toolContext
    )
    
    // #then - should return background message
    expect(result).toContain("Background task continued")
    expect(result).toContain("task-456")
  })
})

  describe("sync mode new task (run_in_background=false)", () => {
    test("sync mode prompt error returns error message immediately", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = {
        launch: async () => ({}),
      }
      
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_sync_error_test" } }),
          prompt: async () => {
            throw new Error("JSON Parse error: Unexpected EOF")
          },
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        app: {
          agents: async () => ({ data: [{ name: "ultrabrain", mode: "subagent" }] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when
      const result = await tool.execute(
        {
          description: "Sync error test",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should return detailed error message with args and stack trace
      expect(result).toContain("Send prompt failed")
      expect(result).toContain("JSON Parse error")
      expect(result).toContain("**Arguments**:")
      expect(result).toContain("**Stack Trace**:")
    })

    test("sync mode success returns task result with content", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = {
        launch: async () => ({}),
      }
      
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_sync_success" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [
              {
                info: { role: "assistant", time: { created: Date.now() } },
                parts: [{ type: "text", text: "Sync task completed successfully" }],
              },
            ],
          }),
          status: async () => ({ data: { "ses_sync_success": { type: "idle" } } }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        app: {
          agents: async () => ({ data: [{ name: "ultrabrain", mode: "subagent" }] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when
      const result = await tool.execute(
        {
          description: "Sync success test",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should return the task result content
      expect(result).toContain("Sync task completed successfully")
      expect(result).toContain("Task completed")
    }, { timeout: 20000 })

    test("sync mode agent not found returns helpful error", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = {
        launch: async () => ({}),
      }
      
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_agent_notfound" } }),
          prompt: async () => {
            throw new Error("Cannot read property 'name' of undefined agent.name")
          },
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        app: {
          agents: async () => ({ data: [{ name: "ultrabrain", mode: "subagent" }] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when
      const result = await tool.execute(
        {
          description: "Agent not found test",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should return agent not found error
      expect(result).toContain("not found")
      expect(result).toContain("registered")
    })

    test("sync mode passes category model to prompt", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      let promptBody: any

      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_sync_model" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }]
          }),
          status: async () => ({ data: {} }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        app: { agents: async () => ({ data: [] }) },
      }

      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
        userCategories: {
          "custom-cat": { model: "provider/custom-model" }
        }
      })

      const toolContext = {
        sessionID: "parent",
        messageID: "msg",
        agent: "sisyphus",
        abort: new AbortController().signal
      }

      // #when
      await tool.execute({
        description: "Sync model test",
        prompt: "test",
        category: "custom-cat",
        run_in_background: false,
        load_skills: ["git-master"]
      }, toolContext)

      // #then
      expect(promptBody.model).toEqual({
        providerID: "provider",
        modelID: "custom-model"
      })
    }, { timeout: 20000 })
  })

  describe("unstable agent forced background mode", () => {
    test("gemini model with run_in_background=false should force background but wait for result", async () => {
      // #given - category using gemini model with run_in_background=false
      const { createDelegateTask } = require("./tools")
      let launchCalled = false
      
      const mockManager = {
        launch: async () => {
          launchCalled = true
          return {
            id: "task-unstable",
            sessionID: "ses_unstable_gemini",
            description: "Unstable gemini task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }
      
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        model: { list: async () => ({ data: [{ provider: "google", id: "gemini-3-pro" }] }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_unstable_gemini" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: Date.now() } }, parts: [{ type: "text", text: "Gemini task completed successfully" }] }
            ]
          }),
          status: async () => ({ data: { "ses_unstable_gemini": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - using visual-engineering (gemini model) with run_in_background=false
      const result = await tool.execute(
        {
          description: "Test gemini forced background",
          prompt: "Do something visual",
          category: "visual-engineering",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should launch as background BUT wait for and return actual result
      expect(launchCalled).toBe(true)
      expect(result).toContain("SUPERVISED TASK COMPLETED")
      expect(result).toContain("Gemini task completed successfully")
    }, { timeout: 20000 })

    test("gemini model with run_in_background=true should not show unstable message (normal background)", async () => {
      // #given - category using gemini model with run_in_background=true (normal background flow)
      const { createDelegateTask } = require("./tools")
      let launchCalled = false
      
      const mockManager = {
        launch: async () => {
          launchCalled = true
          return {
            id: "task-normal-bg",
            sessionID: "ses_normal_bg",
            description: "Normal background task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }
      
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - using visual-engineering with run_in_background=true (normal background)
      const result = await tool.execute(
        {
          description: "Test normal background",
          prompt: "Do something visual",
          category: "visual-engineering",
          run_in_background: true,  // User explicitly says true - normal background
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should NOT show unstable message (it's normal background flow)
      expect(launchCalled).toBe(true)
      expect(result).not.toContain("UNSTABLE AGENT MODE")
      expect(result).toContain("task-normal-bg")
    })

    test("non-gemini model with run_in_background=false should run sync (not forced to background)", async () => {
      // #given - category using non-gemini model with run_in_background=false
      const { createDelegateTask } = require("./tools")
      let launchCalled = false
      let promptCalled = false
      
      const mockManager = {
        launch: async () => {
          launchCalled = true
          return { id: "should-not-be-called", sessionID: "x", description: "x", agent: "x", status: "running" }
        },
      }
      
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_sync_non_gemini" } }),
          prompt: async () => {
            promptCalled = true
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done sync" }] }]
          }),
          status: async () => ({ data: { "ses_sync_non_gemini": { type: "idle" } } }),
        },
      }
      
      // Use ultrabrain which uses gpt-5.2 (non-gemini)
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - using ultrabrain (gpt model) with run_in_background=false
      const result = await tool.execute(
        {
          description: "Test non-gemini sync",
          prompt: "Do something smart",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should run sync, NOT forced to background
      expect(launchCalled).toBe(false)  // manager.launch should NOT be called
      expect(promptCalled).toBe(true)   // sync mode uses session.prompt
      expect(result).not.toContain("UNSTABLE AGENT MODE")
    }, { timeout: 20000 })

    test("artistry category (gemini) with run_in_background=false should force background but wait for result", async () => {
      // #given - artistry also uses gemini model
      const { createDelegateTask } = require("./tools")
      const providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
        connected: ["anthropic", "google", "openai"],
        updatedAt: new Date().toISOString(),
        models: {
          google: ["gemini-3-pro", "gemini-3-flash"],
        },
      })
      let launchCalled = false
      
      const mockManager = {
        launch: async () => {
          launchCalled = true
          return {
            id: "task-artistry",
            sessionID: "ses_artistry_gemini",
            description: "Artistry gemini task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }
      
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        model: { list: async () => ({ data: [{ provider: "google", id: "gemini-3-pro" }] }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_artistry_gemini" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: Date.now() } }, parts: [{ type: "text", text: "Artistry result here" }] }
            ]
          }),
          status: async () => ({ data: { "ses_artistry_gemini": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - artistry category (gemini-3-pro with max variant)
      const result = await tool.execute(
        {
          description: "Test artistry forced background",
          prompt: "Do something artistic",
          category: "artistry",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should launch as background BUT wait for and return actual result
      expect(launchCalled).toBe(true)
      expect(result).toContain("SUPERVISED TASK COMPLETED")
      expect(result).toContain("Artistry result here")
      providerModelsSpy.mockRestore()
    }, { timeout: 20000 })

    test("writing category (gemini-flash) with run_in_background=false should force background but wait for result", async () => {
      // #given - writing uses gemini-3-flash
      const { createDelegateTask } = require("./tools")
      let launchCalled = false
      
      const mockManager = {
        launch: async () => {
          launchCalled = true
          return {
            id: "task-writing",
            sessionID: "ses_writing_gemini",
            description: "Writing gemini task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }
      
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        model: { list: async () => [{ id: "google/gemini-3-flash" }] },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_writing_gemini" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: Date.now() } }, parts: [{ type: "text", text: "Writing result here" }] }
            ]
          }),
          status: async () => ({ data: { "ses_writing_gemini": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - writing category (gemini-3-flash)
      const result = await tool.execute(
        {
          description: "Test writing forced background",
          prompt: "Write something",
          category: "writing",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should launch as background BUT wait for and return actual result
      expect(launchCalled).toBe(true)
      expect(result).toContain("SUPERVISED TASK COMPLETED")
      expect(result).toContain("Writing result here")
    }, { timeout: 20000 })

    test("is_unstable_agent=true should force background but wait for result", async () => {
      // #given - custom category with is_unstable_agent=true but non-gemini model
      const { createDelegateTask } = require("./tools")
      let launchCalled = false
      
      const mockManager = {
        launch: async () => {
          launchCalled = true
          return {
            id: "task-custom-unstable",
            sessionID: "ses_custom_unstable",
            description: "Custom unstable task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }
      
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_custom_unstable" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: Date.now() } }, parts: [{ type: "text", text: "Custom unstable result" }] }
            ]
          }),
          status: async () => ({ data: { "ses_custom_unstable": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
        userCategories: {
          "my-unstable-cat": {
            model: "openai/gpt-5.2",
            is_unstable_agent: true,
          },
        },
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - using custom unstable category with run_in_background=false
      const result = await tool.execute(
        {
          description: "Test custom unstable",
          prompt: "Do something",
          category: "my-unstable-cat",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then - should launch as background BUT wait for and return actual result
      expect(launchCalled).toBe(true)
      expect(result).toContain("SUPERVISED TASK COMPLETED")
      expect(result).toContain("Custom unstable result")
    }, { timeout: 20000 })
  })

  describe("category model resolution fallback", () => {
    test("category uses resolved.model when connectedProvidersCache is null and availableModels is empty", async () => {
      // #given - connectedProvidersCache returns null (simulates missing cache file)
      // This is a regression test for PR #1227 which removed resolved.model from userModel chain
      cacheSpy.mockReturnValue(null)

      const { createDelegateTask } = require("./tools")
      let launchInput: any

      const mockManager = {
        launch: async (input: any) => {
          launchInput = input
          return {
            id: "task-fallback",
            sessionID: "ses_fallback_test",
            description: "Fallback test task",
            agent: "sisyphus-junior",
            status: "running",
          }
        },
      }

      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        model: { list: async () => [] },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }

      // NO userCategories override, NO sisyphusJuniorModel
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
        // userCategories: undefined - use DEFAULT_CATEGORIES only
        // sisyphusJuniorModel: undefined
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - using "quick" category which should use "anthropic/claude-haiku-4-5"
      await tool.execute(
        {
          description: "Test category fallback",
          prompt: "Do something quick",
          category: "quick",
          run_in_background: true,
          load_skills: [],
        },
        toolContext
      )

      // #then - model should be anthropic/claude-haiku-4-5 from DEFAULT_CATEGORIES
      //         NOT anthropic/claude-sonnet-4-5 (system default)
      expect(launchInput.model.providerID).toBe("anthropic")
      expect(launchInput.model.modelID).toBe("claude-haiku-4-5")
    })
  })

  describe("browserProvider propagation", () => {
    test("should resolve agent-browser skill when browserProvider is passed", async () => {
      // #given - delegate_task configured with browserProvider: "agent-browser"
      const { createDelegateTask } = require("./tools")
      let promptBody: any

      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_browser_provider" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }]
          }),
          status: async () => ({ data: {} }),
        },
      }

      // Pass browserProvider to createDelegateTask
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
        browserProvider: "agent-browser",
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - request agent-browser skill
      await tool.execute(
        {
          description: "Test browserProvider propagation",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["agent-browser"],
        },
        toolContext
      )

      // #then - agent-browser skill should be resolved (not in notFound)
      expect(promptBody).toBeDefined()
      expect(promptBody.system).toBeDefined()
      expect(promptBody.system).toContain("agent-browser")
    }, { timeout: 20000 })

    test("should NOT resolve agent-browser skill when browserProvider is not set", async () => {
      // #given - delegate_task without browserProvider (defaults to playwright)
      const { createDelegateTask } = require("./tools")

      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_no_browser_provider" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }]
          }),
          status: async () => ({ data: {} }),
        },
      }

      // No browserProvider passed
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - request agent-browser skill without browserProvider
      const result = await tool.execute(
        {
          description: "Test missing browserProvider",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["agent-browser"],
        },
        toolContext
      )

      // #then - should return skill not found error
      expect(result).toContain("Skills not found")
      expect(result).toContain("agent-browser")
    })
  })

  describe("buildSystemContent", () => {
    test("returns undefined when no skills and no category promptAppend", () => {
      // #given
      const { buildSystemContent } = require("./tools")

      // #when
      const result = buildSystemContent({ skillContent: undefined, categoryPromptAppend: undefined })

      // #then
      expect(result).toBeUndefined()
    })

    test("returns skill content only when skills provided without category", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const skillContent = "You are a playwright expert"

      // #when
      const result = buildSystemContent({ skillContent, categoryPromptAppend: undefined })

      // #then
      expect(result).toBe(skillContent)
    })

    test("returns category promptAppend only when no skills", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const categoryPromptAppend = "Focus on visual design"

      // #when
      const result = buildSystemContent({ skillContent: undefined, categoryPromptAppend })

      // #then
      expect(result).toBe(categoryPromptAppend)
    })

    test("combines skill content and category promptAppend with separator", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const skillContent = "You are a playwright expert"
      const categoryPromptAppend = "Focus on visual design"

      // #when
      const result = buildSystemContent({ skillContent, categoryPromptAppend })

      // #then
      expect(result).toContain(skillContent)
      expect(result).toContain(categoryPromptAppend)
      expect(result).toContain("\n\n")
    })

    test("prepends plan agent system prompt when agentName is 'plan'", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const { PLAN_AGENT_SYSTEM_PREPEND } = require("./constants")

      // #when
      const result = buildSystemContent({ agentName: "plan" })

      // #then
      expect(result).toContain("<system>")
      expect(result).toContain("MANDATORY CONTEXT GATHERING PROTOCOL")
      expect(result).toBe(PLAN_AGENT_SYSTEM_PREPEND)
    })

    test("prepends plan agent system prompt when agentName is 'prometheus'", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const { PLAN_AGENT_SYSTEM_PREPEND } = require("./constants")

      // #when
      const result = buildSystemContent({ agentName: "prometheus" })

      // #then
      expect(result).toContain("<system>")
      expect(result).toBe(PLAN_AGENT_SYSTEM_PREPEND)
    })

    test("prepends plan agent system prompt when agentName is 'Prometheus' (case insensitive)", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const { PLAN_AGENT_SYSTEM_PREPEND } = require("./constants")

      // #when
      const result = buildSystemContent({ agentName: "Prometheus" })

      // #then
      expect(result).toContain("<system>")
      expect(result).toBe(PLAN_AGENT_SYSTEM_PREPEND)
    })

    test("combines plan agent prepend with skill content", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const { PLAN_AGENT_SYSTEM_PREPEND } = require("./constants")
      const skillContent = "You are a planning expert"

      // #when
      const result = buildSystemContent({ skillContent, agentName: "plan" })

      // #then
      expect(result).toContain(PLAN_AGENT_SYSTEM_PREPEND)
      expect(result).toContain(skillContent)
      expect(result!.indexOf(PLAN_AGENT_SYSTEM_PREPEND)).toBeLessThan(result!.indexOf(skillContent))
    })

    test("does not prepend plan agent prompt for non-plan agents", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const skillContent = "You are an expert"

      // #when
      const result = buildSystemContent({ skillContent, agentName: "oracle" })

      // #then
      expect(result).toBe(skillContent)
      expect(result).not.toContain("<system>")
    })

    test("does not prepend plan agent prompt when agentName is undefined", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const skillContent = "You are an expert"

      // #when
      const result = buildSystemContent({ skillContent, agentName: undefined })

      // #then
      expect(result).toBe(skillContent)
      expect(result).not.toContain("<system>")
    })
  })

  describe("modelInfo detection via resolveCategoryConfig", () => {
    test("catalog model is used for category with catalog entry", () => {
      // #given - ultrabrain has catalog entry
      const categoryName = "ultrabrain"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then - catalog model is used
      expect(resolved).not.toBeNull()
      expect(resolved!.config.model).toBe("openai/gpt-5.2-codex")
      expect(resolved!.config.variant).toBe("xhigh")
    })

    test("default model is used for category with default entry", () => {
      // #given - unspecified-low has default model
      const categoryName = "unspecified-low"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then - default model from DEFAULT_CATEGORIES is used
      expect(resolved).not.toBeNull()
      expect(resolved!.config.model).toBe("anthropic/claude-sonnet-4-5")
    })

    test("category built-in model takes precedence over inheritedModel for builtin category", () => {
      // #given - builtin ultrabrain category with its own model, inherited model also provided
      const categoryName = "ultrabrain"
      const inheritedModel = "cliproxy/claude-opus-4-5"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then - category's built-in model wins (ultrabrain uses gpt-5.2-codex)
      expect(resolved).not.toBeNull()
      const actualModel = resolved!.config.model
      expect(actualModel).toBe("openai/gpt-5.2-codex")
    })

    test("when user defines model - modelInfo should report user-defined regardless of inheritedModel", () => {
      // #given
      const categoryName = "ultrabrain"
      const userCategories = { "ultrabrain": { model: "my-provider/custom-model" } }
      const inheritedModel = "cliproxy/claude-opus-4-5"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then - actualModel should be userModel, type should be "user-defined"
      expect(resolved).not.toBeNull()
      const actualModel = resolved!.config.model
      const userDefinedModel = userCategories[categoryName]?.model
      expect(actualModel).toBe(userDefinedModel)
      expect(actualModel).toBe("my-provider/custom-model")
    })

    test("detection logic: actualModel comparison correctly identifies source", () => {
      // #given - This test verifies the fix for PR #770 bug
      // The bug was: checking `if (inheritedModel)` instead of `if (actualModel === inheritedModel)`
      const categoryName = "ultrabrain"
      const inheritedModel = "cliproxy/claude-opus-4-5"
      const userCategories = { "ultrabrain": { model: "user/model" } }
      
      // #when - user model wins
      const resolved = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      const actualModel = resolved!.config.model
      const userDefinedModel = userCategories[categoryName]?.model
      
      // #then - detection should compare against actual resolved model
      const detectedType = actualModel === userDefinedModel 
        ? "user-defined" 
        : actualModel === inheritedModel 
        ? "inherited" 
        : actualModel === SYSTEM_DEFAULT_MODEL 
        ? "system-default" 
        : undefined
      
      expect(detectedType).toBe("user-defined")
      expect(actualModel).not.toBe(inheritedModel)
    })

    // ===== TESTS FOR resolveModel() INTEGRATION (TDD GREEN) =====
    // These tests verify the NEW behavior where categories do NOT have default models

    test("FIXED: category built-in model takes precedence over inheritedModel", () => {
      // #given a builtin category with its own model, and an inherited model from parent
      // The CORRECT chain: userConfig?.model ?? categoryBuiltIn ?? systemDefaultModel
      const categoryName = "ultrabrain"
      const inheritedModel = "anthropic/claude-opus-4-5"
      
      // #when category has a built-in model (gpt-5.2-codex for ultrabrain)
      const resolved = resolveCategoryConfig(categoryName, { inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then category's built-in model should be used, NOT inheritedModel
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("openai/gpt-5.2-codex")
    })

    test("FIXED: systemDefaultModel is used when no userConfig.model and no inheritedModel", () => {
      // #given a custom category with no default model
      const categoryName = "custom-no-default"
      const userCategories = { "custom-no-default": { temperature: 0.5 } } as unknown as Record<string, CategoryConfig>
      const systemDefaultModel = "anthropic/claude-sonnet-4-5"
      
      // #when no inheritedModel is provided, only systemDefaultModel
      const resolved = resolveCategoryConfig(categoryName, { 
        userCategories, 
        systemDefaultModel 
      })
      
      // #then systemDefaultModel should be returned
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("anthropic/claude-sonnet-4-5")
    })

    test("FIXED: userConfig.model always takes priority over everything", () => {
      // #given userConfig.model is explicitly set
      const categoryName = "ultrabrain"
      const userCategories = { "ultrabrain": { model: "custom/user-model" } }
      const inheritedModel = "anthropic/claude-opus-4-5"
      const systemDefaultModel = "anthropic/claude-sonnet-4-5"
      
      // #when resolveCategoryConfig is called with all sources
      const resolved = resolveCategoryConfig(categoryName, { 
        userCategories, 
        inheritedModel, 
        systemDefaultModel 
      })
      
      // #then userConfig.model should win
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("custom/user-model")
    })

    test("FIXED: empty string in userConfig.model is treated as unset and falls back to systemDefault", () => {
      // #given userConfig.model is empty string "" for a custom category (no built-in model)
      const categoryName = "custom-empty-model"
      const userCategories = { "custom-empty-model": { model: "", temperature: 0.3 } }
      const inheritedModel = "anthropic/claude-opus-4-5"
      
      // #when resolveCategoryConfig is called
      const resolved = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then should fall back to systemDefaultModel since custom category has no built-in model
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe(SYSTEM_DEFAULT_MODEL)
    })

    test("FIXED: undefined userConfig.model falls back to category built-in model", () => {
      // #given user sets a builtin category but leaves model undefined
      const categoryName = "visual-engineering"
      // Using type assertion since we're testing fallback behavior for categories without model
      const userCategories = { "visual-engineering": { temperature: 0.2 } } as unknown as Record<string, CategoryConfig>
      const inheritedModel = "anthropic/claude-opus-4-5"
      
      // #when resolveCategoryConfig is called
      const resolved = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then should use category's built-in model (gemini-3-pro for visual-engineering)
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("google/gemini-3-pro")
    })

    test("systemDefaultModel is used when no other model is available", () => {
      // #given - custom category with no model, but systemDefaultModel is set
      const categoryName = "my-custom"
      // Using type assertion since we're testing fallback behavior for categories without model
      const userCategories = { "my-custom": { temperature: 0.5 } } as unknown as Record<string, CategoryConfig>
      const systemDefaultModel = "anthropic/claude-sonnet-4-5"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { userCategories, systemDefaultModel })
      
      // #then - actualModel should be systemDefaultModel
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe(systemDefaultModel)
    })
  })

  describe("prometheus self-delegation block", () => {
    test("prometheus cannot delegate to prometheus - returns error with guidance", async () => {
      // #given - current agent is prometheus
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [{ name: "prometheus", mode: "subagent" }] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "prometheus",
        abort: new AbortController().signal,
      }
      
      // #when - prometheus tries to delegate to prometheus
      const result = await tool.execute(
        {
          description: "Test self-delegation block",
          prompt: "Create a plan",
          subagent_type: "prometheus",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )
      
      // #then - should return error telling prometheus to create plan directly
      expect(result).toContain("prometheus")
      expect(result).toContain("directly")
    })

    test("non-prometheus agent CAN delegate to prometheus - proceeds normally", async () => {
      // #given - current agent is sisyphus
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [{ name: "prometheus", mode: "subagent" }] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_prometheus_allowed" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Plan created successfully" }] }]
          }),
          status: async () => ({ data: { "ses_prometheus_allowed": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - sisyphus delegates to prometheus
      const result = await tool.execute(
        {
          description: "Test prometheus delegation from non-prometheus agent",
          prompt: "Create a plan",
          subagent_type: "prometheus",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )
      
      // #then - should proceed normally
      expect(result).not.toContain("Cannot delegate")
      expect(result).toContain("Plan created successfully")
    }, { timeout: 20000 })

    test("case-insensitive: Prometheus (capitalized) cannot delegate to prometheus", async () => {
      // #given - current agent is Prometheus (capitalized)
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [{ name: "prometheus", mode: "subagent" }] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "Prometheus",
        abort: new AbortController().signal,
      }
      
      // #when - Prometheus tries to delegate to prometheus
      const result = await tool.execute(
        {
          description: "Test case-insensitive block",
          prompt: "Create a plan",
          subagent_type: "prometheus",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )
      
      // #then - should still return error
      expect(result).toContain("prometheus")
      expect(result).toContain("directly")
    })
  })

  describe("subagent_type model extraction (issue #1225)", () => {
    test("background mode passes matched agent model to manager.launch", async () => {
      // #given - agent with model registered, using subagent_type with run_in_background=true
      const { createDelegateTask } = require("./tools")
      let launchInput: any

      const mockManager = {
        launch: async (input: any) => {
          launchInput = input
          return {
            id: "task-explore",
            sessionID: "ses_explore_model",
            description: "Explore task",
            agent: "explore",
            status: "running",
          }
        },
      }

      const mockClient = {
        app: {
          agents: async () => ({
            data: [
              { name: "explore", mode: "subagent", model: { providerID: "anthropic", modelID: "claude-haiku-4-5" } },
            ],
          }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          create: async () => ({ data: { id: "ses_explore_model" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - delegating to explore agent via subagent_type
      await tool.execute(
        {
          description: "Explore codebase",
          prompt: "Find auth patterns",
          subagent_type: "explore",
          run_in_background: true,
          load_skills: [],
        },
        toolContext
      )

      // #then - matched agent's model should be passed to manager.launch
      expect(launchInput.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-haiku-4-5",
      })
    })

    test("sync mode passes matched agent model to session.prompt", async () => {
      // #given - agent with model registered, using subagent_type with run_in_background=false
      const { createDelegateTask } = require("./tools")
      let promptBody: any

      const mockManager = { launch: async () => ({}) }

      const mockClient = {
        app: {
          agents: async () => ({
            data: [
              { name: "oracle", mode: "subagent", model: { providerID: "anthropic", modelID: "claude-opus-4-5" } },
            ],
          }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_oracle_model" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Consultation done" }] }],
          }),
          status: async () => ({ data: { "ses_oracle_model": { type: "idle" } } }),
        },
      }

      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - delegating to oracle agent via subagent_type in sync mode
      await tool.execute(
        {
          description: "Consult oracle",
          prompt: "Review architecture",
          subagent_type: "oracle",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )

      // #then - matched agent's model should be passed to session.prompt
      expect(promptBody.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-opus-4-5",
      })
    }, { timeout: 20000 })

    test("agent without model does not override categoryModel", async () => {
      // #given - agent registered without model field
      const { createDelegateTask } = require("./tools")
      let promptBody: any

      const mockManager = { launch: async () => ({}) }

      const mockClient = {
        app: {
          agents: async () => ({
            data: [
              { name: "explore", mode: "subagent" }, // no model field
            ],
          }),
        },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_no_model_agent" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }],
          }),
          status: async () => ({ data: { "ses_no_model_agent": { type: "idle" } } }),
        },
      }

      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })

      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }

      // #when - delegating to agent without model
      await tool.execute(
        {
          description: "Explore without model",
          prompt: "Find something",
          subagent_type: "explore",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )

      // #then - no model should be passed to session.prompt
      expect(promptBody.model).toBeUndefined()
    }, { timeout: 20000 })
  })

  describe("prometheus subagent delegate_task permission", () => {
    test("prometheus subagent should have delegate_task permission enabled", async () => {
      // #given - sisyphus delegates to prometheus
      const { createDelegateTask } = require("./tools")
      let promptBody: any
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [{ name: "prometheus", mode: "subagent" }] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_prometheus_delegate" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Plan created" }] }]
          }),
          status: async () => ({ data: { "ses_prometheus_delegate": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - sisyphus delegates to prometheus
      await tool.execute(
        {
          description: "Test prometheus delegate_task permission",
          prompt: "Create a plan",
          subagent_type: "prometheus",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )
      
      // #then - prometheus should have delegate_task permission
      expect(promptBody.tools.delegate_task).toBe(true)
    }, { timeout: 20000 })

    test("non-prometheus subagent should NOT have delegate_task permission", async () => {
      // #given - sisyphus delegates to oracle (non-prometheus)
      const { createDelegateTask } = require("./tools")
      let promptBody: any
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [{ name: "oracle", mode: "subagent" }] }) },
        config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_oracle_no_delegate" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Consultation done" }] }]
          }),
          status: async () => ({ data: { "ses_oracle_no_delegate": { type: "idle" } } }),
        },
      }
      
      const tool = createDelegateTask({
        manager: mockManager,
        client: mockClient,
      })
      
      const toolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when - sisyphus delegates to oracle
      await tool.execute(
        {
          description: "Test oracle no delegate_task permission",
          prompt: "Consult on architecture",
          subagent_type: "oracle",
          run_in_background: false,
          load_skills: [],
        },
        toolContext
      )
      
      // #then - oracle should NOT have delegate_task permission
      expect(promptBody.tools.delegate_task).toBe(false)
    }, { timeout: 20000 })
  })
})
