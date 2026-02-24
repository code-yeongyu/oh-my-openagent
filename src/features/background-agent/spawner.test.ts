import { describe, test, expect } from "bun:test"

import { createTask, startTask, compressSessionPromptData, preparePromptWithCompression } from "./spawner"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

const ENABLED_CONFIG: ToonCompressionConfig = {
  enabled: true,
  threshold: 100,
}

const DISABLED_CONFIG: ToonCompressionConfig = {
  enabled: false,
  threshold: 5000,
}

describe("background-agent spawner.startTask", () => {
  test("does not override parent session permission rules when creating child session", async () => {
    //#given
    const createCalls: any[] = []
    const parentPermission = [
      { permission: "question", action: "allow" as const, pattern: "*" },
      { permission: "plan_enter", action: "deny" as const, pattern: "*" },
    ]

    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent/dir", permission: parentPermission } }),
        create: async (args?: any) => {
          createCalls.push(args)
          return { data: { id: "ses_child" } }
        },
        promptAsync: async () => ({}),
      },
    }

    const task = createTask({
      description: "Test task",
      prompt: "Do work",
      agent: "explore",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
    })

    const item = {
      task,
      input: {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionID: task.parentSessionID,
        parentMessageID: task.parentMessageID,
        parentModel: task.parentModel,
        parentAgent: task.parentAgent,
        model: task.model,
      },
    }

    const ctx = {
      client,
      directory: "/fallback",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError: () => {},
    }

    //#when
    await startTask(item as any, ctx as any)

    //#then
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body?.permission).toBeUndefined()
  })
})

describe("compressSessionPromptData", () => {
  describe("#given compression enabled", () => {
    test("compresses structured array data", () => {
      const data = [
        { id: "task1", description: "First task" },
        { id: "task2", description: "Second task" },
        { id: "task3", description: "Third task" },
      ]

      const result = compressSessionPromptData(data, ENABLED_CONFIG)

      expect(result).toContain("task1")
      expect(result).toContain("First task")
    })

    test("returns JSON string for small data", () => {
      const data = { id: "single", description: "Small" }

      const result = compressSessionPromptData(data, ENABLED_CONFIG)

      expect(result).toContain("single")
      expect(result).toContain("Small")
    })
  })

  describe("#given compression disabled", () => {
    test("returns JSON string", () => {
      const data = [
        { id: "task1", description: "First task" },
        { id: "task2", description: "Second task" },
      ]

      const result = compressSessionPromptData(data, DISABLED_CONFIG)

      expect(result).toContain("task1")
      expect(result).toContain("task2")
    })
  })

  describe("#given no config", () => {
    test("uses default config (disabled)", () => {
      const data = { id: "test", value: 42 }

      const result = compressSessionPromptData(data)

      expect(result).toContain("test")
      expect(result).toContain("42")
    })
  })
})

describe("preparePromptWithCompression", () => {
  describe("#given compression enabled", () => {
    test("compresses JSON prompt with structured data", () => {
      const prompt = JSON.stringify([
        { id: "item1", name: "First" },
        { id: "item2", name: "Second" },
        { id: "item3", name: "Third" },
        { id: "item4", name: "Fourth" },
        { id: "item5", name: "Fifth" },
      ])

      const result = preparePromptWithCompression(prompt, ENABLED_CONFIG)

      expect(result).toContain("item1")
      expect(result).toContain("First")
    })

    test("returns plain text prompt as-is", () => {
      const prompt = "This is a plain text prompt without JSON"

      const result = preparePromptWithCompression(prompt, ENABLED_CONFIG)

      expect(result).toBe(prompt)
    })

    test("returns invalid JSON prompt as-is", () => {
      const prompt = "{ invalid json content"

      const result = preparePromptWithCompression(prompt, ENABLED_CONFIG)

      expect(result).toBe(prompt)
    })
  })

  describe("#given compression disabled", () => {
    test("returns prompt unchanged", () => {
      const prompt = JSON.stringify([
        { id: "item1", name: "First" },
        { id: "item2", name: "Second" },
      ])

      const result = preparePromptWithCompression(prompt, DISABLED_CONFIG)

      expect(result).toBe(prompt)
    })
  })

  describe("#given no config", () => {
    test("returns prompt unchanged", () => {
      const prompt = "Plain text prompt"

      const result = preparePromptWithCompression(prompt)

      expect(result).toBe(prompt)
    })
  })
})

describe("background-agent spawner.startTask with compression", () => {
  test("applies compression to prompt when config provided", async () => {
    //#given
    const promptAsyncCalls: any[] = []
    const structuredPrompt = JSON.stringify([
      { id: "item1", name: "First item with long description" },
      { id: "item2", name: "Second item with long description" },
      { id: "item3", name: "Third item with long description" },
      { id: "item4", name: "Fourth item with long description" },
      { id: "item5", name: "Fifth item with long description" },
    ])

    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent/dir" } }),
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async (args?: any) => {
          promptAsyncCalls.push(args)
        },
      },
    }

    const task = createTask({
      description: "Test task",
      prompt: structuredPrompt,
      agent: "explore",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
    })

    const item = {
      task,
      input: {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionID: task.parentSessionID,
        parentMessageID: task.parentMessageID,
        parentModel: task.parentModel,
        parentAgent: task.parentAgent,
        model: task.model,
      },
    }

    const ctx = {
      client,
      directory: "/fallback",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError: () => {},
      toonCompressionConfig: ENABLED_CONFIG,
    }

    //#when
    await startTask(item as any, ctx as any)

    //#then
    expect(promptAsyncCalls.length).toBeGreaterThanOrEqual(1)
    const promptText = promptAsyncCalls[0]?.body?.parts?.[0]?.text
    expect(promptText).toContain("item1")
  })

  test("does not apply compression when config not provided", async () => {
    //#given
    const promptAsyncCalls: any[] = []
    const plainPrompt = "Plain text prompt without JSON"

    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent/dir" } }),
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async (args?: any) => {
          promptAsyncCalls.push(args)
        },
      },
    }

    const task = createTask({
      description: "Test task",
      prompt: plainPrompt,
      agent: "explore",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
    })

    const item = {
      task,
      input: {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionID: task.parentSessionID,
        parentMessageID: task.parentMessageID,
        parentModel: task.parentModel,
        parentAgent: task.parentAgent,
        model: task.model,
      },
    }

    const ctx = {
      client,
      directory: "/fallback",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError: () => {},
    }

    //#when
    await startTask(item as any, ctx as any)

    //#then
    expect(promptAsyncCalls.length).toBeGreaterThanOrEqual(1)
    const promptText = promptAsyncCalls[0]?.body?.parts?.[0]?.text
    expect(promptText).toContain(plainPrompt)
  })
})
