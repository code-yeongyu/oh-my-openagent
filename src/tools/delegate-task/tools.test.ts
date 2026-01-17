import { describe, test, expect } from "bun:test"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, CATEGORY_DESCRIPTIONS, DELEGATE_TASK_DESCRIPTION } from "./constants"
import { resolveCategoryConfig } from "./tools"
import type { CategoryConfig } from "../../config/schema"

// Test constants - systemDefaultModel is required by resolveCategoryConfig
const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5"

describe("sisyphus-task", () => {
  describe("DEFAULT_CATEGORIES", () => {
    test("visual-engineering category has temperature config only (model removed)", () => {
      // #given
      const category = DEFAULT_CATEGORIES["visual-engineering"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBeUndefined()
      expect(category.temperature).toBe(0.7)
    })

    test("ultrabrain category has temperature config only (model removed)", () => {
      // #given
      const category = DEFAULT_CATEGORIES["ultrabrain"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBeUndefined()
      expect(category.temperature).toBe(0.1)
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

    test("most-capable category exists and has description", () => {
      // #given / #when
      const description = CATEGORY_DESCRIPTIONS["most-capable"]

      // #then
      expect(description).toBeDefined()
      expect(description).toContain("Complex")
    })
  })

  describe("DELEGATE_TASK_DESCRIPTION", () => {
    test("documents background parameter as required with default false", () => {
      // #given / #when / #then
      expect(DELEGATE_TASK_DESCRIPTION).toContain("background")
      expect(DELEGATE_TASK_DESCRIPTION).toContain("Default: false")
    })

    test("warns about parallel exploration usage", () => {
      // #given / #when / #then
      expect(DELEGATE_TASK_DESCRIPTION).toContain("5+")
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
          skills: [],
        },
        toolContext
      )
      
      // #then returns descriptive error message
      expect(result).toContain("No default model configured")
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

    test("returns systemDefaultModel for builtin category (categories no longer have default models)", () => {
      // #given
      const categoryName = "visual-engineering"

      // #when
      const result = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then - model comes from systemDefaultModel since categories no longer have model defaults
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe(SYSTEM_DEFAULT_MODEL)
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
          model: "google/gemini-3-pro-preview",
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
          model: "google/gemini-3-pro-preview",
          temperature: 0.3,
        },
      }

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.temperature).toBe(0.3)
    })

    test("inheritedModel takes precedence over systemDefaultModel", () => {
      // #given - builtin category, parent model provided
      const categoryName = "visual-engineering"
      const inheritedModel = "cliproxy/claude-opus-4-5"

      // #when
      const result = resolveCategoryConfig(categoryName, { inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then - inheritedModel wins over systemDefaultModel
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("cliproxy/claude-opus-4-5")
    })

    test("inheritedModel is used as fallback when category has no user model", () => {
      // #given - custom category with no model defined, only inheritedModel as fallback
      const categoryName = "my-custom-no-model"
      const userCategories = { "my-custom-no-model": { temperature: 0.5 } } as unknown as Record<string, CategoryConfig>
      const inheritedModel = "cliproxy/claude-opus-4-5"

      // #when
      const result = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then - parent model is used as fallback since custom category has no user model
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("cliproxy/claude-opus-4-5")
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

    test("systemDefaultModel is used when no user model and no inheritedModel", () => {
      // #given
      const categoryName = "visual-engineering"

      // #when
      const result = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe(SYSTEM_DEFAULT_MODEL)
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
            agent: "Sisyphus-Junior",
            status: "running",
          }
        },
      }

      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
          skills: [],
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
  })

  describe("skills parameter", () => {
    test("DELEGATE_TASK_DESCRIPTION documents skills parameter with empty array option", () => {
      // #given / #when / #then
      expect(DELEGATE_TASK_DESCRIPTION).toContain("skills")
      expect(DELEGATE_TASK_DESCRIPTION).toContain("Array of skill names")
      expect(DELEGATE_TASK_DESCRIPTION).toContain("[] (empty array) if no skills needed")
    })

    test("skills parameter is required - returns error when not provided", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
        },
        toolContext
      )
      
      // #then - should return error about missing skills
      expect(result).toContain("skills")
      expect(result).toContain("REQUIRED")
    })

    test("null skills returns error", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          skills: null,
        },
        toolContext
      )
      
      // #then - should return error about null
      expect(result).toContain("Invalid arguments")
      expect(result).toContain("skills=null")
      expect(result).toContain("not allowed")
      expect(result).toContain("skills=[]")
    })

    test("empty array [] is allowed and proceeds without skill content", async () => {
      // #given
      const { createDelegateTask } = require("./tools")
      let promptBody: any
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
      
      // #when - empty array skills passed
      await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "ultrabrain",
          run_in_background: false,
          skills: [],
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
      config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
        skills: [],
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
      config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
        skills: [],
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
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
          skills: [],
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
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
          skills: [],
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
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
          skills: [],
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
        config: { get: async () => ({ model: SYSTEM_DEFAULT_MODEL }) },
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
        skills: []
      }, toolContext)

      // #then
      expect(promptBody.model).toEqual({
        providerID: "provider",
        modelID: "custom-model"
      })
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
    test("systemDefaultModel is used when no userModel and no inheritedModel", () => {
      // #given - builtin category, no user model, no inherited model
      const categoryName = "ultrabrain"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then - actualModel should be systemDefaultModel (categories no longer have model defaults)
      expect(resolved).not.toBeNull()
      const actualModel = resolved!.config.model
      expect(actualModel).toBe(SYSTEM_DEFAULT_MODEL)
    })

    test("inheritedModel takes precedence over systemDefaultModel for builtin category", () => {
      // #given - builtin ultrabrain category, inherited model from parent
      const categoryName = "ultrabrain"
      const inheritedModel = "cliproxy/claude-opus-4-5"
      
      // #when
      const resolved = resolveCategoryConfig(categoryName, { inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then - inheritedModel wins over systemDefaultModel
      expect(resolved).not.toBeNull()
      const actualModel = resolved!.config.model
      expect(actualModel).toBe("cliproxy/claude-opus-4-5")
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

    test("FIXED: inheritedModel takes precedence over systemDefaultModel", () => {
      // #given a builtin category, and an inherited model from parent
      // The NEW correct chain: userConfig?.model ?? inheritedModel ?? systemDefaultModel
      const categoryName = "ultrabrain"
      const inheritedModel = "anthropic/claude-opus-4-5" // inherited from parent session
      
      // #when userConfig.model is undefined and inheritedModel is set
      const resolved = resolveCategoryConfig(categoryName, { inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then inheritedModel should be used, NOT systemDefaultModel
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("anthropic/claude-opus-4-5")
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

    test("FIXED: empty string in userConfig.model is treated as unset and falls back", () => {
      // #given userConfig.model is empty string ""
      const categoryName = "custom-empty-model"
      const userCategories = { "custom-empty-model": { model: "", temperature: 0.3 } }
      const inheritedModel = "anthropic/claude-opus-4-5"
      
      // #when resolveCategoryConfig is called
      const resolved = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then should fall back to inheritedModel since "" is normalized to undefined
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("anthropic/claude-opus-4-5")
    })

    test("FIXED: undefined userConfig.model falls back to inheritedModel", () => {
      // #given user explicitly sets a category but leaves model undefined
      const categoryName = "visual-engineering"
      // Using type assertion since we're testing fallback behavior for categories without model
      const userCategories = { "visual-engineering": { temperature: 0.2 } } as unknown as Record<string, CategoryConfig>
      const inheritedModel = "anthropic/claude-opus-4-5"
      
      // #when resolveCategoryConfig is called
      const resolved = resolveCategoryConfig(categoryName, { userCategories, inheritedModel, systemDefaultModel: SYSTEM_DEFAULT_MODEL })
      
      // #then should use inheritedModel
      expect(resolved).not.toBeNull()
      expect(resolved!.model).toBe("anthropic/claude-opus-4-5")
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
