import { describe, test, expect, beforeEach } from "bun:test"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, CATEGORY_DESCRIPTIONS } from "./constants"
import { resolveCategoryConfig } from "./tools"
import type { CategoryConfig } from "../../config/schema"
import { __resetModelCache } from "../../shared/model-availability"

// Test constants - systemDefaultModel is required by resolveCategoryConfig
const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5"

describe("sisyphus-task", () => {
  // Reset model cache before each test to prevent cross-test pollution
  beforeEach(() => {
    __resetModelCache()
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
  })

  describe("CATEGORY_PROMPT_APPENDS", () => {
    test("visual-engineering category has design-focused prompt", () => {
      // #given
      const promptAppend = CATEGORY_PROMPT_APPENDS["visual-engineering"]

      // #when / #then
      expect(promptAppend).toContain("VISUAL/UI")
      expect(promptAppend).toContain("Design-first")
    })

    test("ultrabrain category has strategic prompt", () => {
      // #given
      const promptAppend = CATEGORY_PROMPT_APPENDS["ultrabrain"]

      // #when / #then
      expect(promptAppend).toContain("BUSINESS LOGIC")
      expect(promptAppend).toContain("Strategic advisor")
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

  describe("category delegation config validation", () => {
    test("returns error when systemDefaultModel is not configured", async () => {
      // #given a mock client with no model in config
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
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
        agent: "Sisyphus",
        abort: new AbortController().signal,
      }
      
      // #when delegating with a category
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          load_skills: ["git-master"],
        },
        toolContext
      )
      
      // #then returns descriptive error message
      expect(result).toContain("oh-my-opencode requires a default model")
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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

      // #then - variant MUST be "max" from DEFAULT_CATEGORIES
      expect(promptBody.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-opus-4-5",
        variant: "max",
      })
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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

  describe("resume with background parameter", () => {
  test("resume with background=false should wait for result and return content", async () => {
    // Note: This test needs extended timeout because the implementation has MIN_STABILITY_TIME_MS = 5000
    // #given
    const { createDelegateTask } = require("./tools")
    
    const mockTask = {
      id: "task-123",
      sessionID: "ses_resume_test",
      description: "Resumed task",
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
              parts: [{ type: "text", text: "This is the resumed task result" }],
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
      agent: "Sisyphus",
      abort: new AbortController().signal,
    }
    
    // #when
    const result = await tool.execute(
      {
        description: "Resume test",
        prompt: "Continue the task",
        resume: "ses_resume_test",
        run_in_background: false,
        load_skills: ["git-master"],
      },
      toolContext
    )
    
    // #then - should contain actual result, not just "Background task resumed"
    expect(result).toContain("This is the resumed task result")
    expect(result).not.toContain("Background task resumed")
  }, { timeout: 10000 })

  test("resume with background=true should return immediately without waiting", async () => {
    // #given
    const { createDelegateTask } = require("./tools")
    
    const mockTask = {
      id: "task-456",
      sessionID: "ses_bg_resume",
      description: "Background resumed task",
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
      agent: "Sisyphus",
      abort: new AbortController().signal,
    }
    
    // #when
    const result = await tool.execute(
      {
        description: "Resume bg test",
        prompt: "Continue in background",
        resume: "ses_bg_resume",
        run_in_background: true,
        load_skills: ["git-master"],
      },
      toolContext
    )
    
    // #then - should return background message
    expect(result).toContain("Background task resumed")
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        model: { list: async () => [{ id: "google/gemini-3-pro" }] },
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        model: { list: async () => [{ id: "google/gemini-3-pro" }] },
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
        agent: "Sisyphus",
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
})
