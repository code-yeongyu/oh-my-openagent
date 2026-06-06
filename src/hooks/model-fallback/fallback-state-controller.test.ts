import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import type { ModelFallbackState } from "./hook"

const readConnectedProvidersCacheMock = mock((): string[] | null => null)
const readProviderModelsCacheMock = mock((): ProviderModelsCache | null => null)

mock.module("../../shared/connected-providers-cache", () => ({
  readConnectedProvidersCache: readConnectedProvidersCacheMock,
  readProviderModelsCache: readProviderModelsCacheMock,
}))

const { createModelFallbackStateController } = await import("./fallback-state-controller")
const { hasEligibleFallback } = await import("./next-fallback")

function createController() {
  return createModelFallbackStateController({
    pendingModelFallbacks: new Map(),
    lastToastKey: new Map(),
    sessionFallbackChains: new Map(),
  })
}

describe("model fallback state controller provider switch", () => {
  afterAll(() => {
    mock.restore()
  })

  beforeEach(() => {
    readConnectedProvidersCacheMock.mockReturnValue(null)
    readProviderModelsCacheMock.mockReturnValue(null)
  })

  test("arms provider-scoped fallback when a cross-provider candidate exists", () => {
    //#given
    const controller = createController()
    const sessionID = "ses_provider_scoped_cross_provider"
    controller.setSessionFallbackChain(sessionID, [
      { providers: ["provider-a"], model: "fallback-model-1" },
      { providers: ["provider-b"], model: "fallback-model-2" },
    ])

    //#when
    const set = controller.setPendingModelFallback(sessionID, "Agent", "provider-a", "original-model", true)
    const fallback = controller.getNextFallback(sessionID)

    //#then
    expect(set).toBe(true)
    expect(fallback).toMatchObject({
      providerID: "provider-b",
      modelID: "fallback-model-2",
    })
  })

  test("refuses provider-scoped fallback when all candidates stay on the current provider", () => {
    //#given
    const controller = createController()
    const sessionID = "ses_provider_scoped_same_provider_only"
    controller.setSessionFallbackChain(sessionID, [
      { providers: ["provider-a"], model: "fallback-model-1" },
      { providers: ["provider-a"], model: "fallback-model-2" },
    ])

    //#when
    const set = controller.setPendingModelFallback(sessionID, "Agent", "provider-a", "original-model", true)

    //#then
    expect(set).toBe(false)
    expect(controller.hasPendingModelFallback(sessionID)).toBe(false)
    expect(controller.getFallbackState(sessionID)).toBeUndefined()
  })

  test("allows same-provider different-model fallback when provider switch is not required", () => {
    //#given
    const controller = createController()
    const sessionID = "ses_transient_same_provider"
    controller.setSessionFallbackChain(sessionID, [
      { providers: ["provider-a"], model: "fallback-model-1" },
    ])

    //#when
    const set = controller.setPendingModelFallback(sessionID, "Agent", "provider-a", "original-model", false)
    const fallback = controller.getNextFallback(sessionID)

    //#then
    expect(set).toBe(true)
    expect(fallback).toMatchObject({
      providerID: "provider-a",
      modelID: "fallback-model-1",
    })
  })

  test("checks eligible fallback without mutating attemptCount", () => {
    //#given
    const stateWithCrossProvider: ModelFallbackState = {
      providerID: "provider-a",
      modelID: "original-model",
      fallbackChain: [
        { providers: ["provider-a"], model: "fallback-model-1" },
        { providers: ["provider-b"], model: "fallback-model-2" },
      ],
      attemptCount: 0,
      pending: true,
      requiresProviderSwitch: true,
    }
    const stateWithOnlySameProviderRemaining: ModelFallbackState = {
      providerID: "provider-a",
      modelID: "original-model",
      fallbackChain: [
        { providers: ["provider-b"], model: "fallback-model-1" },
        { providers: ["provider-a"], model: "fallback-model-2" },
      ],
      attemptCount: 1,
      pending: true,
      requiresProviderSwitch: true,
    }
    const crossProviderAttemptCount = stateWithCrossProvider.attemptCount
    const sameProviderAttemptCount = stateWithOnlySameProviderRemaining.attemptCount

    //#when
    const crossProviderResult = hasEligibleFallback(stateWithCrossProvider)
    const sameProviderResult = hasEligibleFallback(stateWithOnlySameProviderRemaining)

    //#then
    expect(crossProviderResult).toBe(true)
    expect(sameProviderResult).toBe(false)
    expect(stateWithCrossProvider.attemptCount).toBe(crossProviderAttemptCount)
    expect(stateWithOnlySameProviderRemaining.attemptCount).toBe(sameProviderAttemptCount)
  })
})
