import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import { createHooks } from "../create-hooks"
import { createFirstMessageVariantGate } from "../shared/first-message-variant"
import type { PluginInterface } from "../plugin/types"
import { createV2Setup } from "../v2-setup"

type AddedTool = { name: string }
type AddedCommand = { name: string; execute: (input: unknown) => Promise<void> }

function buildMockCtx(failOnToolAdd: boolean) {
  const addedTools: AddedTool[] = []
  const addedCommands: AddedCommand[] = []
  const prompted: Array<{ sessionID: string; text: string }> = []
  const ctx = {
    location: {
      directory: "/tmp/omo-v2-setup-test",
      project: { id: "proj-test", directory: "/tmp/omo-v2-setup-test" },
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
      scan: async () => ({ entries: [], next: undefined }),
    },
    event: {
      subscribe: async function* () {},
    },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      prompt: async (input: { sessionID: string; text: string }) => {
        prompted.push({ sessionID: input.sessionID, text: input.text })
        return { id: "msg-1" }
      },
    },
    tool: {
      transform: async (callback: (editor: { add: (registration: AddedTool) => void }) => void) => {
        if (failOnToolAdd) {
          callback({
            add: () => {
              throw new Error("tool add boom")
            },
          })
        } else {
          callback({
            add: (registration: AddedTool) => {
              addedTools.push(registration)
            },
          })
        }
        return { dispose: async () => {} }
      },
      hook: async () => ({ dispose: async () => {} }),
    },
    command: {
      transform: async (callback: (editor: { add: (definition: AddedCommand) => void }) => void) => {
        callback({
          add: (definition: AddedCommand) => {
            addedCommands.push(definition)
          },
        })
        return { dispose: async () => {} }
      },
    },
    skill: {
      transform: async () => ({ dispose: async () => {} }),
    },
  } as unknown as Plugin.Context
  return { ctx, addedTools, addedCommands, prompted }
}

function stubFactories() {
  return {
    createManagers: () =>
      ({
        backgroundManager: { shutdown: async () => {} },
        skillMcpManager: { disconnectAll: async () => {} },
        tuiStateMirror: undefined,
        monitorManager: undefined,
      }) as unknown as Managers,
    createTools: async () => ({
      filteredTools: {
        echo: tool({ description: "echo", args: {}, execute: async () => "ok" }),
      },
      mergedSkills: [],
      availableSkills: [],
      availableCategories: [],
      browserProvider: "playwright",
      disabledSkills: new Set<string>(),
      taskSystemEnabled: false,
    }),
    createHooks: () =>
      ({
        disposeHooks: () => {},
      }) as unknown as ReturnType<typeof createHooks>,
    createPluginInterface: () => ({}) as unknown as PluginInterface,
    createFirstMessageVariantGate: () =>
      ({}) as unknown as ReturnType<typeof createFirstMessageVariantGate>,
  }
}

function stubLoadConfig() {
  return {
    valid: true,
    messages: [],
    path: null,
    config: {} as OhMyOpenCodeConfig,
  }
}

describe("#given createV2Setup", () => {
  describe("#when called", () => {
    it("#then returns an async setup function", () => {
      // given
      const setup = createV2Setup({ log: () => {} })

      // then
      expect(typeof setup).toBe("function")
    })
  })

  describe("#when tool registration throws", () => {
    it("#then setup and cleanup still resolve without throwing", async () => {
      // given
      const { ctx } = buildMockCtx(true)
      const setup = createV2Setup({
        log: () => {},
        loadConfig: stubLoadConfig,
        factories: stubFactories(),
      })

      // when
      const cleanup = await setup(ctx)

      // then
      expect(typeof cleanup).toBe("function")
      await cleanup()
    })
  })

  describe("#when running with stub factories", () => {
    it("#then registers tools and builtin commands, and command execute prompts", async () => {
      // given
      const { ctx, addedTools, addedCommands, prompted } = buildMockCtx(false)
      const setup = createV2Setup({
        log: () => {},
        loadConfig: stubLoadConfig,
        factories: stubFactories(),
      })

      // when
      const cleanup = await setup(ctx)

      // then
      expect(addedTools.map((registration) => registration.name)).toEqual(["echo"])
      expect(addedCommands.length).toBeGreaterThan(0)
      const goal = addedCommands.find((command) => command.name === "goal")
      expect(goal).toBeDefined()
      await goal?.execute({ sessionID: "ses-1", prompt: { text: "my objective" }, delivery: "queue" })
      expect(prompted.length).toBe(1)
      expect(prompted[0]?.sessionID).toBe("ses-1")
      expect(prompted[0]?.text).toContain("my objective")

      // when
      await cleanup()

      // then
      expect(true).toBe(true)
    })
  })
})
