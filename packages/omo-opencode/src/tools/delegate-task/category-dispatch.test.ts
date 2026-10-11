import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { OmoCategoryConfigSchema } from "@oh-my-opencode/omo-config-core"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "../../features/background-agent/manager"
import type { BackgroundTask } from "../../features/background-agent/types"
import { clearBackgroundTaskRegistryForTesting } from "../../features/background-agent/task-registry"
import { createChatParamsHandler } from "../../plugin/chat-params"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { clearAllSessionPromptParams } from "../../shared/session-prompt-params-state"
import { releaseAllPromptAsyncReservationsForTesting, releasePromptAsyncReservation } from "../../shared/prompt-async-gate"
import type { CategoryConfig } from "../../config/schema"
import { DEFAULT_CATEGORIES } from "./builtin-categories"
import { resolveCategoryExecution } from "./category-resolver"
import { createSyncSession } from "./sync-session-creator"
import { sendSyncPrompt } from "./sync-prompt-sender"
import { resolveSubagentModel } from "./subagent-model-resolution"
import type { DelegateTaskArgs } from "./types"

type Dispatch = {
  path: { id: string }
  body: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
    options?: Record<string, unknown>
  }
}

const builtin = DEFAULT_CATEGORIES["unspecified-high"]
const builtinModel = builtin.model
if (!builtinModel) throw new Error("unspecified-high must configure a builtin model")
const builtinProvider = builtinModel.slice(0, builtinModel.indexOf("/"))
const builtinID = builtinModel.slice(builtinModel.indexOf("/") + 1)
const cases: Array<{
  name: string
  category?: string
  availableModels?: Record<string, string[]>
  expectedModel?: { providerID: string; modelID: string }
  config?: CategoryConfig
  variant?: string
  effort?: string
}> = [
  { name: "user model reasoning", config: { model: "openai/gpt-5.4", reasoning: "high" }, variant: "high" },
  { name: "user models reasoning", config: { models: [{ model: "openai/gpt-5.4", reasoning: "high" }] }, variant: "high" },
  { name: "promoted models reasoning", config: { models: ["fixture/unavailable", { model: "openai/gpt-5.4", reasoning: "high" }] }, variant: "high" },
  { name: "builtin model", variant: builtin.variant },
  {
    name: "builtin fallback without own variant",
    category: "quick",
    availableModels: { xai: ["grok-4.20-0309-non-reasoning"] },
    expectedModel: { providerID: "xai", modelID: "grok-4.20-0309-non-reasoning" },
    variant: "low",
  },
  { name: "loaded reasoning overrides legacy variant", config: { model: "openai/gpt-5.4", variant: "low", reasoning: "high" }, variant: "high" },
  { name: "loaded reasoning overrides legacy default", config: { model: "openai/gpt-5.4", variant: "default", reasoning: "high" }, variant: "high" },
  { name: "loaded legacy default", config: { model: "openai/gpt-5.4", variant: "default" }, variant: "default" },
  { name: "entry variant", config: { models: [{ model: "openai/gpt-5.4", variant: "low" }] }, variant: "low" },
  { name: "user model without level", config: { model: "openai/gpt-5.4" } },
  { name: "user chain without level", config: { models: ["openai/gpt-5.4"] } },
  { name: "native effort without variant", config: { model: "openai/gpt-5.4", reasoning: "off" }, effort: "none" },
]

let cacheSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
    connected: [...new Set(["openai", "fixture", builtinProvider])],
    models: {
      openai: ["gpt-5.4"],
      fixture: ["plain-model"],
      [builtinProvider]: [...new Set([...(builtinProvider === "openai" ? ["gpt-5.4"] : []), builtinID])],
    },
    updatedAt: new Date().toISOString(),
  })
})
afterEach(() => {
  cacheSpy.mockRestore()
  clearAllSessionPromptParams()
  releaseAllPromptAsyncReservationsForTesting()
  clearBackgroundTaskRegistryForTesting()
})

describe("category settings at provider request boundaries", () => {
  for (const entry of cases) {
    for (const path of ["sync", "background", "resume"] as const) {
      test(`${entry.name}: ${path}`, async () => {
        // given
        if (entry.availableModels) {
          cacheSpy.mockReturnValue({
            connected: Object.keys(entry.availableModels),
            models: entry.availableModels,
            updatedAt: new Date().toISOString(),
          })
        }
        const sessionID = `ses_${crypto.randomUUID()}`
        const created: Array<{ body: { model?: { variant?: string } } }> = []
        let dispatched = Promise.withResolvers<Dispatch>()
        const client = {
          session: {
            get: async () => ({ data: { directory: "/tmp" } }),
            create: async (input: { body: { model?: { variant?: string } } }) => {
              created.push(input)
              return { data: { id: sessionID } }
            },
            promptAsync: async (input: Dispatch) => {
              dispatched.resolve(input)
              return {}
            },
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
            abort: async () => ({}),
          },
        }
        const manager = new BackgroundManager({
          pluginContext: unsafeTestValue({ client, directory: "/tmp" }),
          enableParentSessionNotifications: false,
        })
        const args: DelegateTaskArgs = {
          category: entry.category ?? "unspecified-high",
          prompt: "Return the dispatch sentinel.",
          description: "Category dispatch regression",
          load_skills: [],
          run_in_background: path !== "sync",
        }
        try {
          // when
          const resolution = await resolveCategoryExecution(args, {
            client: unsafeTestValue(client),
            manager,
            directory: "/tmp",
            userCategories: entry.config ? { [args.category!]: OmoCategoryConfigSchema.parse(entry.config) } : undefined,
          }, undefined, undefined)
          expect(resolution.error).toBeUndefined()
          expect(resolution.categoryModel).toBeDefined()

          if (path === "sync") {
            await createSyncSession(unsafeTestValue(client), {
              parentSessionID: "ses_parent",
              agentToUse: resolution.agentToUse,
              description: args.description,
              defaultDirectory: "/tmp",
              categoryModel: resolution.categoryModel,
            })
            const result = await sendSyncPrompt(unsafeTestValue(client), {
              sessionID,
              agentToUse: resolution.agentToUse,
              args,
              systemContent: undefined,
              categoryModel: resolution.categoryModel,
              directory: "/tmp",
              toastManager: undefined,
              taskId: undefined,
            }, {
              promptWithModelSuggestionRetry: async (_client, input) => {
                dispatched.resolve(unsafeTestValue(input))
              },
            })
            expect(result).toBeNull()
          } else {
            const task = await manager.launch({
              description: args.description,
              prompt: args.prompt,
              agent: resolution.agentToUse,
              parentSessionId: "ses_parent",
              parentMessageId: "msg_parent",
              model: resolution.categoryModel,
              category: args.category,
            })
            await dispatched.promise
            if (path === "resume") {
              // End the first attempt before subscribing to the continuation dispatch.
              const runningTask = manager.getTask(task.id)
              if (!runningTask) throw new Error("Launched task was not registered")
              expect(await unsafeTestValue<{
                tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
              }>(manager).tryCompleteTask(runningTask, "test")).toBe(true)
              releasePromptAsyncReservation(sessionID, "model-suggestion-retry")
              dispatched = Promise.withResolvers<Dispatch>()
              await manager.resume({
                sessionId: sessionID,
                prompt: "Continue with the same settings.",
                parentSessionId: "ses_parent",
                parentMessageId: "msg_resume",
              })
            }
          }
          const request = await dispatched.promise
          if (entry.expectedModel) expect(request.body.model).toEqual(entry.expectedModel)
          const dispatchedVariant = request.body.variant
          const output = { options: { ...request.body.options } }
          await createChatParamsHandler()({
            sessionID,
            agent: request.body.agent,
            model: request.body.model,
            provider: { id: request.body.model.providerID },
            message: request.body,
          }, output)
          // then: session creation and the provider-facing hook agree.
          expect({
            createdVariant: created[0]?.body.model?.variant,
            dispatchedVariant,
            providerVariant: request.body.variant,
            reasoningEffort: output.options.reasoningEffort,
          }).toEqual({
            createdVariant: entry.variant,
            dispatchedVariant: entry.variant,
            providerVariant: entry.variant === "default" ? undefined : entry.variant,
            reasoningEffort: entry.effort,
          })
        } finally {
          manager.shutdown()
        }
      }, 10_000)
    }
  }
})

test("direct agent override does not inherit its category's builtin variant", async () => {
  // given / when
  const result = await resolveSubagentModel("explore", { name: "explore", mode: "subagent" }, {
    client: unsafeTestValue({}),
    manager: unsafeTestValue({}),
    directory: "/tmp",
    agentOverrides: { explore: { model: "openai/gpt-5.4", category: "unspecified-high" } },
  })
  // then
  expect(result.categoryModel).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
})
