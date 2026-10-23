import { describe, expect, test } from "bun:test"

import { abortableSleep } from "./otlp-sleep"

describe("retry sleep", () => {
  test("#given sleeps that end normally #then each one removes the abort listener it added", async () => {
    // given
    const signal = new AbortController().signal
    let added = 0
    let removed = 0
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
      added += 1
      add(...args)
    }) as AbortSignal["addEventListener"]
    signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
      removed += 1
      remove(...args)
    }) as AbortSignal["removeEventListener"]

    // when
    for (let index = 0; index < 5; index += 1) await abortableSleep(1, signal)

    // then
    expect(added).toBe(5)
    expect(removed).toBe(5)
  })
})
