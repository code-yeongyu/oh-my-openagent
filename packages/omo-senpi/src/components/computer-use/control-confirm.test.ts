/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { ComputerHostContext } from "@oh-my-opencode/senpi-desktop-tool"

import {
  CONTROL_CONFIRM_TIMEOUT_MS,
  CONTROL_CONFIRM_TITLE,
  confirmComputerControl,
  controlConfirmBody,
  type ControlTimeoutScheduler,
} from "./control-confirm"

function hostContext(options: {
  readonly hasUI?: boolean
  readonly confirm?: (title: string, body: string, opts?: { signal?: AbortSignal; timeout?: number }) => Promise<boolean>
}): ComputerHostContext {
  return {
    cwd: "/work",
    model: undefined,
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => "/tmp/omo-computer-use-test" },
    ...(options.hasUI === undefined ? {} : { hasUI: options.hasUI }),
    ...(options.confirm === undefined ? {} : { ui: { confirm: options.confirm } }),
  }
}

describe("confirmComputerControl (#9651 B5b)", () => {
  test("#given hasUI false #when acquiring #then it never prompts and never grants", async () => {
    // given
    let prompts = 0

    // when
    const approved = await confirmComputerControl({
      context: hostContext({
        hasUI: false,
        confirm: () => {
          prompts += 1
          return Promise.resolve(true)
        },
      }),
      reason: "click Run",
      signal: new AbortController().signal,
    })

    // then
    expect({ approved, prompts }).toEqual({ approved: false, prompts: 0 })
  })

  test("#given a context without a confirm-capable ui #when acquiring #then it never grants", async () => {
    // when
    const approved = await confirmComputerControl({
      context: hostContext({ hasUI: true }),
      reason: "click Run",
      signal: new AbortController().signal,
    })

    // then
    expect(approved).toBe(false)
  })

  test("#given a refusal #when acquiring #then it never grants", async () => {
    // when
    const approved = await confirmComputerControl({
      context: hostContext({ hasUI: true, confirm: () => Promise.resolve(false) }),
      reason: "click Run",
      signal: new AbortController().signal,
    })

    // then
    expect(approved).toBe(false)
  })

  test("#given an approval #when acquiring #then it grants with the upstream wording and the run signal", async () => {
    // given
    const seen: Array<{ title: string; body: string; hasSignal: boolean }> = []
    const signal = new AbortController().signal

    // when
    const approved = await confirmComputerControl(
      {
        context: hostContext({
          hasUI: true,
          confirm: (title, body, opts) => {
            seen.push({ title, body, hasSignal: opts?.signal === signal })
            return Promise.resolve(true)
          },
        }),
        reason: "click Run",
        signal,
      }),
      { timeoutMs: 1234 },
    )

    // then
    expect(approved).toBe(true)
    expect(seen).toEqual([{ title: CONTROL_CONFIRM_TITLE, body: controlConfirmBody("click Run"), hasSignal: true }])
    expect(seen[0]?.body).toContain("click Run")
    expect(seen[0]?.body).toContain("For this task only.")
    expect(seen[0]?.body).toContain("does not authorize external side effects")
  })

  test("#given a client that never answers #when the confirm timeout fires #then it stays ungranted", async () => {
    // given: an RPC-mode client whose confirm promise never settles
    let fireTimeout: (() => void) | undefined
    let scheduledMs: number | undefined
    const scheduleTimeout: ControlTimeoutScheduler = (onTimeout, timeoutMs) => {
      fireTimeout = onTimeout
      scheduledMs = timeoutMs
      return () => undefined
    }
    const promise = confirmComputerControl(
      {
        context: hostContext({ hasUI: true, confirm: () => new Promise<boolean>(() => undefined) }),
        reason: "click Run",
        signal: new AbortController().signal,
      },
      { scheduleTimeout },
    )

    // when
    expect(scheduledMs).toBe(CONTROL_CONFIRM_TIMEOUT_MS)
    fireTimeout?.()

    // then
    expect(await promise).toBe(false)
  })

  test("#given an already-aborted signal #when acquiring #then it never prompts", async () => {
    // given
    let prompts = 0
    const controller = new AbortController()
    controller.abort()

    // when
    const approved = await confirmComputerControl({
      context: hostContext({
        hasUI: true,
        confirm: () => {
          prompts += 1
          return Promise.resolve(true)
        },
      }),
      reason: "click Run",
      signal: controller.signal,
    })

    // then
    expect({ approved, prompts }).toEqual({ approved: false, prompts: 0 })
  })

  test("#given an abort while the confirm is pending #when a late yes arrives #then it is discarded", async () => {
    // given
    let answer: ((approved: boolean) => void) | undefined
    const controller = new AbortController()
    const promise = confirmComputerControl({
      context: hostContext({
        hasUI: true,
        confirm: () =>
          new Promise<boolean>((resolve) => {
            answer = resolve
          }),
      }),
      reason: "click Run",
      signal: controller.signal,
    })

    // when
    controller.abort()
    answer?.(true)

    // then
    expect(await promise).toBe(false)
  })
})
