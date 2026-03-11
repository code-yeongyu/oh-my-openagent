import { describe, expect, spyOn, test } from "bun:test"
import * as dbOverrideModule from "./ultrawork-db-model-override"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import { resolveValidUltraworkVariant } from "./ultrawork-variant-availability"

describe("resolveValidUltraworkVariant", () => {
  function createClient(models: Record<string, Record<string, unknown>>) {
    return {
      provider: {
        list: async () => ({
          data: {
            all: Object.entries(models).map(([providerID, providerModels]) => ({
              id: providerID,
              models: providerModels,
            })),
          },
        }),
      },
    }
  }

  test("#given provider sdk metadata #when variant exists #then returns variant", async () => {
    // given
    const client = createClient({
      anthropic: {
        "claude-opus-4-6": {
          variants: {
            max: {},
            high: {},
          },
        },
      },
    })

    // when
    const result = await resolveValidUltraworkVariant(
      client,
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
      "max",
    )

    // then
    expect(result).toBe("max")
  })

  test("#given provider sdk metadata #when variant does not exist #then returns undefined", async () => {
    // given
    const client = createClient({
      anthropic: {
        "claude-opus-4-6": {
          variants: {
            high: {},
          },
        },
      },
    })

    // when
    const result = await resolveValidUltraworkVariant(
      client,
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
      "max",
    )

    // then
    expect(result).toBeUndefined()
  })
})

describe("applyUltraworkModelOverrideOnMessage variant guard", () => {
  function createClient(models: Record<string, Record<string, unknown>>) {
    return {
      provider: {
        list: async () => ({
          data: {
            all: Object.entries(models).map(([providerID, providerModels]) => ({
              id: providerID,
              models: providerModels,
            })),
          },
        }),
      },
    }
  }

  test("#given ultrawork variant missing from target model #when override applies #then skips forced variant change", async () => {
    // given
    const client = createClient({
      anthropic: {
        "claude-opus-4-6": {
          variants: {
            high: {},
          },
        },
      },
    })
    const dbOverrideSpy = spyOn(dbOverrideModule, "scheduleDeferredModelOverride").mockImplementation(() => {})

    const config = {
      agents: {
        sisyphus: {
          ultrawork: {
            model: "anthropic/claude-opus-4-6",
            variant: "max",
          },
        },
      },
    } as Parameters<typeof applyUltraworkModelOverrideOnMessage>[0]

    const output = {
      message: {
        id: "msg_123",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      } as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    // when
    await applyUltraworkModelOverrideOnMessage(
      config,
      "sisyphus",
      output,
      { showToast: async () => {} },
      undefined,
      client,
    )

    // then
    expect(output.message["variant"]).toBeUndefined()
    expect(output.message["thinking"]).toBeUndefined()
    expect(dbOverrideSpy).toHaveBeenCalledWith(
      "msg_123",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
      undefined,
    )
    dbOverrideSpy.mockRestore()
  })

  test("#given variant only ultrawork config without valid current model variant #when override applies #then skips override entirely", async () => {
    // given
    const client = createClient({
      anthropic: {
        "claude-sonnet-4-6": {
          variants: {
            high: {},
          },
        },
      },
    })
    const dbOverrideSpy = spyOn(dbOverrideModule, "scheduleDeferredModelOverride").mockImplementation(() => {})

    const config = {
      agents: {
        sisyphus: {
          ultrawork: {
            variant: "max",
          },
        },
      },
    } as Parameters<typeof applyUltraworkModelOverrideOnMessage>[0]

    const output = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      } as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    // when
    await applyUltraworkModelOverrideOnMessage(
      config,
      "sisyphus",
      output,
      { showToast: async () => {} },
      undefined,
      client,
    )

    // then
    expect(output.message["variant"]).toBeUndefined()
    expect(output.message["thinking"]).toBeUndefined()
    expect(dbOverrideSpy).not.toHaveBeenCalled()
    expect(output.message.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    dbOverrideSpy.mockRestore()
  })
})
