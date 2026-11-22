/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createOmoSenpiComponents } from "../../extension/component-list"
import type { OmoSenpiComponent } from "../../extension/types"
import { createJsKernelGuardComponent, JS_KERNEL_GUARD_COMPONENT_NAME, JS_KERNEL_GUARD_TOOL_NAME } from "./index"
import { JS_KERNEL_GUARD_GLOBAL, PROCESS_EXIT_IN_CELL } from "./prelude"

function context(): ComponentContext {
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  return { logger, config: { getFlag: () => undefined } }
}

interface RegisteredTool {
  readonly name: string
  readonly exposure?: string
  readonly kernelPrelude?: { readonly javascript: string; readonly exports: readonly string[] }
}

describe("js kernel guard component", () => {
  test("#given extension registration #when the guard component registers #then the eval prelude rejects process.exit", () => {
    // given
    const pi = new FakeExtensionAPI()
    createJsKernelGuardComponent().register(pi, context())
    const tool = pi.tools.find((entry) => entry["name"] === JS_KERNEL_GUARD_TOOL_NAME) as RegisteredTool | undefined
    const calls: number[] = []
    const process = {
      exit(code?: number): never {
        calls.push(code ?? 0)
        return undefined as never
      },
    }
    const target: Record<string, unknown> = {}

    // when
    const run = new Function("process", "globalThis", tool?.kernelPrelude?.javascript ?? "") as (
      process: { exit: (code?: number) => never },
      target: Record<string, unknown>,
    ) => void
    run(process, target)
    let caught: unknown
    try {
      process.exit(1)
    } catch (error) {
      caught = error
    }

    // then
    expect(tool?.exposure).toBe("eval")
    expect(tool?.kernelPrelude?.exports).toEqual([JS_KERNEL_GUARD_GLOBAL])
    expect(target[JS_KERNEL_GUARD_GLOBAL]).toBe(true)
    expect(calls).toEqual([])
    expect((caught as Error).name).toBe(PROCESS_EXIT_IN_CELL)
  })

  test("#given the production component list #when names are read #then the guard is registered once", () => {
    // given
    const task: OmoSenpiComponent = { name: "task", register() {} }

    // when
    const names = createOmoSenpiComponents(task)
      .map((component) => component.name)
      .filter((name) => name === JS_KERNEL_GUARD_COMPONENT_NAME)

    // then
    expect(names).toEqual([JS_KERNEL_GUARD_COMPONENT_NAME])
  })
})
