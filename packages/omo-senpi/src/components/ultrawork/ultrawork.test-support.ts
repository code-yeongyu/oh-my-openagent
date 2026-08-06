import { expect } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"
import { createSessionArming, createUltraworkComponent } from "./index"

const ULTRAWORK_CUSTOM_TYPE = "omo-ultrawork:directive"
const ARMING_LEDGER_KEY = Symbol.for("omo.ultrawork.arming")

export type InputDispatchResult = { action: "continue" } | { action: "transform"; text: string }

export function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = {
    info() {},
    warn() {},
    error() {},
  }

  return {
    logger,
    config: {
      getFlag(name) {
        return pi.getFlag(name)
      },
    },
  }
}

export async function dispatchInput(
  pi: FakeExtensionAPI,
  text: unknown,
  source: unknown = "interactive",
  streamingBehavior?: unknown,
  eventCtx?: unknown,
): Promise<InputDispatchResult> {
  const [result] = await pi.dispatch(
    "input",
    {
      type: "input",
      text,
      source,
      ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
    },
    eventCtx,
  )
  // The fake API types handler results as unknown; the ultrawork input handler
  // only ever returns this union, so the cast here is the typed boundary.
  return result as InputDispatchResult
}

/**
 * Registers the component with an isolated arming ledger so one test's armed
 * sessions can never leak into another's through the process-shared default
 * ledger — which only the re-registration coverage may exercise directly.
 */
export async function registerIsolatedUltrawork(pi: FakeExtensionAPI): Promise<void> {
  await createUltraworkComponent(createSessionArming()).register(pi, createTestContext(pi))
}

export function sessionEventCtx(sessionId: string): { sessionManager: { getSessionId(): string } } {
  return { sessionManager: { getSessionId: () => sessionId } }
}

/**
 * Seeds the process-global arming slot the way an earlier bundle evaluation left
 * it and returns a restore function. Only the reload-path tests may touch this
 * slot; every other test stays isolated through registerIsolatedUltrawork.
 */
export function seedSharedArmingSlot(slot: unknown): () => void {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const previous = registry[ARMING_LEDGER_KEY]
  registry[ARMING_LEDGER_KEY] = slot
  return () => {
    if (previous === undefined) {
      delete registry[ARMING_LEDGER_KEY]
      return
    }
    registry[ARMING_LEDGER_KEY] = previous
  }
}

/**
 * A re-armed session must get a SHORT nudge, never a second ~17KB directive: the
 * transcript already holds every rule, so the reminder stays under 400 chars and
 * carries no "<ultrawork-mode>" open tag that would read as a fresh block.
 */
export function expectReminderMessage(pi: FakeExtensionAPI, index: number): void {
  const call = pi.messages[index]
  expect(call?.message["customType"]).toBe(ULTRAWORK_CUSTOM_TYPE)
  expect(call?.message["display"]).toBe(false)
  const content = call?.message["content"]
  if (typeof content !== "string") {
    throw new Error("expected a string reminder message")
  }
  expect(content.length).toBeLessThan(400)
  expect(content).not.toContain("<ultrawork-mode>")
  expect(content).not.toBe(SENPI_ULTRAWORK_DIRECTIVE)
}

/** The directive must ride in as ONE hidden custom message, never as rewritten user text. */
export function expectHiddenInjection(pi: FakeExtensionAPI, result: unknown, expectedDeliverAs?: "steer" | "followUp"): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(1)

  const [call] = pi.messages
  expect(call?.message["customType"]).toBe(ULTRAWORK_CUSTOM_TYPE)
  expect(call?.message["display"]).toBe(false)
  expect(call?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
  expect(call?.options?.["deliverAs"]).toBe(expectedDeliverAs)
}

export function expectNoInjection(pi: FakeExtensionAPI, result: unknown): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(0)
}

/**
 * A prompt queued mid-stream must carry its directive INSIDE the same message.
 * Senpi drains steering and follow-up queues one message at a time by default, and
 * runs an assistant turn per drained message, so a separate hidden message would
 * burn its own turn before the user's ask ever arrives.
 */
export function expectAtomicQueuedInjection(pi: FakeExtensionAPI, result: unknown, prompt: string): void {
  expect(result).toEqual({ action: "transform", text: `${prompt}\n${SENPI_ULTRAWORK_DIRECTIVE}` })
  expect(pi.messages).toHaveLength(0)
}

export function markerCount(text: string): number {
  return text.match(/<ultrawork-mode>/g)?.length ?? 0
}
