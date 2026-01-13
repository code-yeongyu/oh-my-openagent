import { describe, test, expect } from "bun:test"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, CATEGORY_DESCRIPTIONS, SISYPHUS_TASK_DESCRIPTION } from "./constants"
import type { CategoryConfig } from "../../config/schema"

function resolveCategoryConfig(
  categoryName: string,
  userCategories?: Record<string, CategoryConfig>
): { config: CategoryConfig; promptAppend: string } | null {
  const defaultConfig = DEFAULT_CATEGORIES[categoryName]
  const userConfig = userCategories?.[categoryName]
  const defaultPromptAppend = CATEGORY_PROMPT_APPENDS[categoryName] ?? ""

  if (!defaultConfig && !userConfig) {
    return null
  }

  const config: CategoryConfig = {
    ...defaultConfig,
    ...userConfig,
    model: userConfig?.model ?? defaultConfig?.model ?? "anthropic/claude-sonnet-4-5",
  }

  let promptAppend = defaultPromptAppend
  if (userConfig?.prompt_append) {
    promptAppend = defaultPromptAppend
      ? defaultPromptAppend + "\n\n" + userConfig.prompt_append
      : userConfig.prompt_append
  }

  return { config, promptAppend }
}

describe("sisyphus-task", () => {
  describe("DEFAULT_CATEGORIES", () => {
    test("visual-engineering category has gemini model", () => {
      // #given
      const category = DEFAULT_CATEGORIES["visual-engineering"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBe("google/gemini-3-pro-preview")
      expect(category.temperature).toBe(0.7)
    })

    test("ultrabrain category has gpt model", () => {
      // #given
      const category = DEFAULT_CATEGORIES["ultrabrain"]

      // #when / #then
      expect(category).toBeDefined()
      expect(category.model).toBe("openai/gpt-5.2")
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

  describe("SISYPHUS_TASK_DESCRIPTION", () => {
    test("documents background parameter as required with default false", () => {
      // #given / #when / #then
      expect(SISYPHUS_TASK_DESCRIPTION).toContain("background")
      expect(SISYPHUS_TASK_DESCRIPTION).toContain("Default: false")
    })

    test("warns about parallel exploration usage", () => {
      // #given / #when / #then
      expect(SISYPHUS_TASK_DESCRIPTION).toContain("5+")
    })
  })

  describe("resolveCategoryConfig", () => {
    test("returns null for unknown category without user config", () => {
      // #given
      const categoryName = "unknown-category"

      // #when
      const result = resolveCategoryConfig(categoryName)

      // #then
      expect(result).toBeNull()
    })

    test("returns default config for builtin category", () => {
      // #given
      const categoryName = "visual-engineering"

      // #when
      const result = resolveCategoryConfig(categoryName)

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.model).toBe("google/gemini-3-pro-preview")
      expect(result!.promptAppend).toContain("VISUAL/UI")
    })

    test("user config overrides default model", () => {
      // #given
      const categoryName = "visual-engineering"
      const userCategories = {
        "visual-engineering": { model: "anthropic/claude-opus-4-5" },
      }

      // #when
      const result = resolveCategoryConfig(categoryName, userCategories)

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
      const result = resolveCategoryConfig(categoryName, userCategories)

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
      const result = resolveCategoryConfig(categoryName, userCategories)

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
      const result = resolveCategoryConfig(categoryName, userCategories)

      // #then
      expect(result).not.toBeNull()
      expect(result!.config.temperature).toBe(0.3)
    })
  })

  describe("category variant", () => {
    test("passes variant to background model payload", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
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
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createSisyphusTask({
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
    test("SISYPHUS_TASK_DESCRIPTION documents skills parameter", () => {
      // #given / #when / #then
      expect(SISYPHUS_TASK_DESCRIPTION).toContain("skills")
      expect(SISYPHUS_TASK_DESCRIPTION).toContain("Array of skill names")
    })

    test("skills parameter is required - returns error when not provided", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
      
      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        app: { agents: async () => ({ data: [] }) },
        session: {
          create: async () => ({ data: { id: "test-session" } }),
          prompt: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      }
      
      const tool = createSisyphusTask({
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
  })

  describe("resume with background parameter", () => {
  test("resume with background=false should wait for result and return content", async () => {
    // Note: This test needs extended timeout because the implementation has MIN_STABILITY_TIME_MS = 5000
    // #given
    const { createSisyphusTask } = require("./tools")
    
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
      app: {
        agents: async () => ({ data: [] }),
      },
    }
    
    const tool = createSisyphusTask({
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
    const { createSisyphusTask } = require("./tools")
    
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
    }
    
    const tool = createSisyphusTask({
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
      const { createSisyphusTask } = require("./tools")
      
      const mockManager = {
        launch: async () => ({}),
      }
      
      const mockClient = {
        session: {
          create: async () => ({ data: { id: "ses_sync_error_test" } }),
          prompt: async () => {
            throw new Error("JSON Parse error: Unexpected EOF")
          },
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
        app: {
          agents: async () => ({ data: [{ name: "ultrabrain", mode: "subagent" }] }),
        },
      }
      
      const tool = createSisyphusTask({
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
      
      // #then - should return error message with the prompt error
      expect(result).toContain("❌")
      expect(result).toContain("Failed to send prompt")
      expect(result).toContain("JSON Parse error")
    })

    test("sync mode success returns task result with content", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
      
      const mockManager = {
        launch: async () => ({}),
      }
      
      const mockClient = {
        session: {
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
        app: {
          agents: async () => ({ data: [{ name: "ultrabrain", mode: "subagent" }] }),
        },
      }
      
      const tool = createSisyphusTask({
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
      const { createSisyphusTask } = require("./tools")
      
      const mockManager = {
        launch: async () => ({}),
      }
      
      const mockClient = {
        session: {
          create: async () => ({ data: { id: "ses_agent_notfound" } }),
          prompt: async () => {
            throw new Error("Cannot read property 'name' of undefined agent.name")
          },
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
        app: {
          agents: async () => ({ data: [{ name: "ultrabrain", mode: "subagent" }] }),
        },
      }
      
      const tool = createSisyphusTask({
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
      expect(result).toContain("❌")
      expect(result).toContain("not found")
      expect(result).toContain("registered")
    })

    test("sync mode passes category model to prompt", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
      let promptBody: any

      const mockManager = { launch: async () => ({}) }
      const mockClient = {
        session: {
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
        app: { agents: async () => ({ data: [] }) },
      }

      const tool = createSisyphusTask({
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
      const result = buildSystemContent({ skills: undefined, categoryPromptAppend: undefined })

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
})
