import { describe, expect, test } from "bun:test"

import { TaskConcurrency } from "./concurrency"

describe("TaskConcurrency", () => {
  test("#given default settings #when nothing acquired #then a fresh model has a free slot", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 5 })

    // when
    const free = concurrency.hasFreeSlot("anthropic/claude")

    // then
    expect(free).toBe(true)
  })

  test("#given limit reached #when checking free slot #then it reports full and exposes queue position", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 1 })
    concurrency.acquire("anthropic/claude", "st_00000001")

    // when
    const free = concurrency.hasFreeSlot("anthropic/claude")
    const position = concurrency.enqueue("anthropic/claude", "st_00000002", () => {})

    // then
    expect(free).toBe(false)
    expect(position).toBe(1)
  })

  test("#given a waiter enqueued #when the holder releases #then the waiter callback fires (FIFO handoff)", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 1 })
    concurrency.acquire("anthropic/claude", "st_00000001")
    let granted = false
    concurrency.enqueue("anthropic/claude", "st_00000002", () => {
      granted = true
    })

    // when
    concurrency.release("anthropic/claude")

    // then
    expect(granted).toBe(true)
  })

  test("#given two waiters #when slots free one at a time #then they are granted in FIFO order", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 1 })
    concurrency.acquire("openai/gpt", "st_00000001")
    const order: string[] = []
    concurrency.enqueue("openai/gpt", "st_00000002", () => order.push("second"))
    concurrency.enqueue("openai/gpt", "st_00000003", () => order.push("third"))

    // when
    concurrency.release("openai/gpt")
    concurrency.release("openai/gpt")

    // then
    expect(order).toEqual(["second", "third"])
  })

  test("#given model and provider overrides #when resolving a key #then model override wins over provider", () => {
    // given
    const concurrency = new TaskConcurrency({
      default_concurrency: 5,
      model_concurrency: { "anthropic/opus": 2 },
      provider_concurrency: { anthropic: 3 },
    })

    // when
    const modelKey = concurrency.getKey("anthropic/opus")
    const providerKey = concurrency.getKey("anthropic/sonnet")

    // then
    expect(modelKey).toBe("anthropic/opus")
    expect(providerKey).toBe("anthropic")
    expect(concurrency.getLimit("anthropic/opus")).toBe(2)
    expect(concurrency.getLimit("anthropic/sonnet")).toBe(3)
  })

  test("#given different models #when both acquire under a shared default limit #then each keeps its own count", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 1 })

    // when
    concurrency.acquire("anthropic/claude", "st_00000001")
    const otherFree = concurrency.hasFreeSlot("openai/gpt")

    // then
    expect(otherFree).toBe(true)
  })
})
