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

    test("includes workdir context when workdir is provided", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const workdir = "/path/to/worktree"

      // #when
      const result = buildSystemContent({ workdir })

      // #then
      expect(result).toContain("<Workdir_Context>")
      expect(result).toContain(workdir)
      expect(result).toContain("WORKING DIRECTORY:")
      expect(result).toContain("CRITICAL CONSTRAINTS")
    })

    test("combines workdir with skill content and category promptAppend", () => {
      // #given
      const { buildSystemContent } = require("./tools")
      const skillContent = "You are a playwright expert"
      const categoryPromptAppend = "Focus on visual design"
      const workdir = "/path/to/worktree"

      // #when
      const result = buildSystemContent({ skillContent, categoryPromptAppend, workdir })

      // #then
      expect(result).toContain(skillContent)
      expect(result).toContain(categoryPromptAppend)
      expect(result).toContain("<Workdir_Context>")
      expect(result).toContain(workdir)
      // Should have separators between all parts
      const parts = result.split("\n\n")
      expect(parts.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe("workdir validation", () => {
    test("returns error when workdir does not exist", async () => {
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
      
      // #when
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "general",
          run_in_background: false,
          skills: [],
          workdir: "/nonexistent/path/that/does/not/exist",
        },
        toolContext
      )
      
      // #then
      expect(result).toContain("does not exist")
      expect(result).toContain("workdir")
    })

    test("returns error when workdir is not an absolute path", async () => {
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
      
      // #when
      const result = await tool.execute(
        {
          description: "Test task",
          prompt: "Do something",
          category: "general",
          run_in_background: false,
          skills: [],
          workdir: "relative/path",
        },
        toolContext
      )
      
      // #then
      expect(result).toContain("must be an absolute path")
      expect(result).toContain("workdir")
    })

    test("returns error when workdir is not a directory", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
      const fs = require("node:fs")
      const path = require("node:path")
      const os = require("node:os")
      
      // Create a temporary file (not a directory)
      const tmpFile = path.join(os.tmpdir(), `test-file-${Date.now()}`)
      fs.writeFileSync(tmpFile, "test")
      
      try {
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
        
        // #when
        const result = await tool.execute(
          {
            description: "Test task",
            prompt: "Do something",
            category: "general",
            run_in_background: false,
            skills: [],
            workdir: tmpFile,
          },
          toolContext
        )
        
        // #then
        expect(result).toContain("not a directory")
        expect(result).toContain("workdir")
      } finally {
        // Cleanup
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile)
        }
      }
    })
  })

  describe("workdir injection in background launch", () => {
    test("background launch includes workdir in skillContent", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
      const fs = require("node:fs")
      const os = require("node:os")
      const path = require("node:path")
      
      const workdir = path.join(os.tmpdir(), `test-workdir-${Date.now()}`)
      fs.mkdirSync(workdir, { recursive: true })
      
      try {
        let launchInput: any

        const mockManager = {
          launch: async (input: any) => {
            launchInput = input
            return {
              id: "task-workdir",
              sessionID: "session-workdir",
              description: "Workdir task",
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
            description: "Workdir task",
            prompt: "Do something",
            category: "general",
            run_in_background: true,
            skills: [],
            workdir,
          },
          toolContext
        )

        // #then
        expect(launchInput.skillContent).toContain("<Workdir_Context>")
        expect(launchInput.skillContent).toContain(workdir)
      } finally {
        // Cleanup
        if (fs.existsSync(workdir)) {
          fs.rmSync(workdir, { recursive: true, force: true })
        }
      }
    })
  })

  describe("workdir injection in sync execution", () => {
    test("sync execution includes workdir in system content", async () => {
      // #given
      const { createSisyphusTask } = require("./tools")
      const fs = require("node:fs")
      const os = require("node:os")
      const path = require("node:path")
      
      const workdir = path.join(os.tmpdir(), `test-workdir-sync-${Date.now()}`)
      fs.mkdirSync(workdir, { recursive: true })
      
      try {
        let promptInput: any
        const sessionId = "test-session-sync"
        let pollCount = 0

        const mockManager = { launch: async () => ({}) }
        const mockClient = {
          app: { agents: async () => ({ data: [] }) },
          session: {
            create: async () => ({ data: { id: sessionId } }),
            prompt: async (input: any) => {
              promptInput = input
              return { data: {} }
            },
            messages: async () => {
              // Return consistent message count to allow stability detection
              return {
                data: [
                  {
                    info: { role: "assistant", time: { created: Date.now() } },
                    parts: [{ type: "text", text: "Task completed" }],
                  },
                ],
              }
            },
            status: async () => {
              // After initial polls, return idle to allow completion
              pollCount++
              return {
                data: {
                  [sessionId]: {
                    type: pollCount > 5 ? "idle" : "running",
                  },
                },
              }
            },
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
            description: "Sync workdir task",
            prompt: "Do something",
            category: "general",
            run_in_background: false,
            skills: [],
            workdir,
          },
          toolContext
        )

        // #then
        expect(promptInput.body.system).toContain("<Workdir_Context>")
        expect(promptInput.body.system).toContain(workdir)
        expect(result).toBeDefined()
      } finally {
        // Cleanup
        if (fs.existsSync(workdir)) {
          fs.rmSync(workdir, { recursive: true, force: true })
        }
      }
    }, { timeout: 15000 })
  })
})
