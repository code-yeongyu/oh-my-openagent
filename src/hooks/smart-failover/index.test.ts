import { describe, expect, test, mock, beforeEach } from "bun:test"
import { createSmartFailoverHook } from "./index"
import { ProviderStatusManager } from "../../features/failover/status-manager"
import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"

describe("smart-failover hook", () => {
  let ctx: PluginInput
  let config: OhMyOpenCodeConfig
  let statusManager: ProviderStatusManager
  let modelCacheState: ModelCacheState

  beforeEach(() => {
    ProviderStatusManager.getInstance().reset()
    statusManager = ProviderStatusManager.getInstance()
    
    ctx = {
      client: {
        tui: {
          showToast: mock(() => Promise.resolve())
        },
        session: {
          abort: mock(() => Promise.resolve()),
          prompt: mock(() => Promise.resolve())
        }
      }
    } as unknown as PluginInput

    config = {
      model: "primary/model",
      agents: {
        sisyphus: {
          model: "primary/model | fallback/model"
        }
      }
    }

    modelCacheState = {
      modelContextLimitsCache: new Map(),
      anthropicContext1MEnabled: false
    }
  })

  test("chat.message should allow healthy primary", async () => {
    const hook = createSmartFailoverHook(ctx, config, modelCacheState)
    const output = { message: {} } as any
    
    await hook["chat.message"](
      { sessionID: "ses-1", agent: "Sisyphus", model: { providerID: "primary", modelID: "model" } },
      output
    )

    expect(output.message.model).toBeUndefined()
  })

  test("chat.message should swap cooling primary", async () => {
    statusManager.markCooling("primary/model", 10000, "test")
    
    const hook = createSmartFailoverHook(ctx, config, modelCacheState)
    const output = { message: {} } as any
    
    await hook["chat.message"](
      { sessionID: "ses-1", agent: "Sisyphus", model: { providerID: "primary", modelID: "model" } },
      output
    )

    expect(output.message.model).toEqual({ providerID: "fallback", modelID: "model" })
    await new Promise(resolve => setTimeout(resolve, 1600))
    expect(ctx.client.tui.showToast).toHaveBeenCalled()
  })

  test("session.error should mark model cooling with backoff", async () => {
    const hook = createSmartFailoverHook(ctx, config, modelCacheState)
    const output = { message: {} } as any
    
    await hook["chat.message"](
      { sessionID: "ses-1", agent: "Sisyphus", model: { providerID: "primary", modelID: "model" } },
      output
    )

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses-1",
          error: "Rate limit reached"
        }
      }
    })

    const state1 = statusManager.getState("primary/model")
    expect(state1?.status).toBe("COOLING")
    expect(state1?.retryCount).toBe(1)
    
    expect(ctx.client.session.abort).toHaveBeenCalled()
  })

  test("session.idle should recover probation model", async () => {
    statusManager.markCooling("primary/model", -1000, "test")
    
    const hook = createSmartFailoverHook(ctx, config, modelCacheState)
    const output = { message: {} } as any
    
    await hook["chat.message"](
      { sessionID: "ses-1", agent: "Sisyphus", model: { providerID: "primary", modelID: "model" } },
      output
    )

    expect(statusManager.getStatus("primary/model")).toBe("PROBATION")

    await hook.event({
      event: {
        type: "session.idle",
        properties: {
          sessionID: "ses-1"
        }
      }
    })

    expect(statusManager.getStatus("primary/model")).toBe("HEALTHY")
  })
})
