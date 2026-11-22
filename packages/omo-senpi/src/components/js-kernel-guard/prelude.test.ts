/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { JS_KERNEL_GUARD_GLOBAL, jsKernelGuardPreludeSource, PROCESS_EXIT_IN_CELL } from "./prelude"

interface ExitProcess {
  exit: (code?: number) => never
}

function install(process: ExitProcess, target: Record<string, unknown>): void {
  const run = new Function("process", "globalThis", jsKernelGuardPreludeSource()) as (
    process: ExitProcess,
    target: Record<string, unknown>,
  ) => void
  run(process, target)
}

describe("js kernel guard prelude", () => {
  test("#given the kernel already bound process.exit #when a cell calls process.exit #then the kernel binding still exits and the cell call throws", () => {
    // given
    const calls: Array<number | undefined> = []
    const process: ExitProcess = {
      exit(code?: number): never {
        calls.push(code)
        return undefined as never
      },
    }
    const kernelExit = process.exit.bind(process)
    const target: Record<string, unknown> = {}

    // when
    install(process, target)
    kernelExit(0)
    let cellError: unknown
    try {
      process.exit(1)
    } catch (error) {
      cellError = error
    }

    // then
    expect(calls).toEqual([0])
    expect(target[JS_KERNEL_GUARD_GLOBAL]).toBe(true)
    expect(cellError).toBeInstanceOf(Error)
    expect((cellError as Error).name).toBe(PROCESS_EXIT_IN_CELL)
  })

  test("#given an imported module whose catch calls process.exit #when the guard is installed #then the exit becomes a thrown error and the original exit is not called", () => {
    // given
    const calls: number[] = []
    const process: ExitProcess = {
      exit(code?: number): never {
        calls.push(code ?? 0)
        return undefined as never
      },
    }
    install(process, {})

    const imported = (): void => {
      try {
        throw new Error("node-agent: missing required environment variable BUNSHIN_HUB_URL")
      } catch {
        process.exit(1)
      }
    }

    // when
    let caught: unknown
    try {
      imported()
    } catch (error) {
      caught = error
    }

    // then
    expect(calls).toEqual([])
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe(PROCESS_EXIT_IN_CELL)
  })
})
