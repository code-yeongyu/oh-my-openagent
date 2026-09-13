import { expect } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createSkillPointersComponent } from "./index"

export type InputDispatchResult = { action: "continue" } | { action: "transform"; text: string }

export interface ExpectedPointer {
  readonly customType: string
  readonly skillName: string
}

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
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

export async function registerSkillPointers(pi: FakeExtensionAPI): Promise<void> {
  await createSkillPointersComponent().register(pi, createTestContext(pi))
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
  return result as InputDispatchResult
}

export function expectPointerInjections(pi: FakeExtensionAPI, result: unknown, expected: readonly ExpectedPointer[]): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(expected.length)
  expect(pi.messages.map((call) => call.message["customType"])).toEqual(expected.map((entry) => entry.customType))
  for (const [index, entry] of expected.entries()) {
    const call = pi.messages[index]
    expect(call?.message["display"]).toBe(false)
    const content = call?.message["content"]
    if (typeof content !== "string") {
      throw new Error("expected a string skill-pointer message")
    }
    expect(content).toContain(`<omo-${entry.skillName}-pointer>`)
    expect(content).toContain(`${entry.skillName}/SKILL.md`)
  }
}

export function expectNoInjection(pi: FakeExtensionAPI, result: unknown): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(0)
}

export function injectedContent(pi: FakeExtensionAPI, customType: string): string {
  const call = pi.messages.find((entry) => entry.message["customType"] === customType)
  const content = call?.message["content"]
  if (typeof content !== "string") {
    throw new Error(`expected a string message for ${customType}`)
  }
  return content
}
