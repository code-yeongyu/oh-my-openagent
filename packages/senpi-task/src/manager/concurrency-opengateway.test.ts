import { describe, expect, test } from "bun:test"

import { TaskConcurrency } from "./concurrency"

describe("OpenGateway default concurrency", () => {
  test.each([
    {},
    { default_concurrency: 1 },
    { default_concurrency: 2, provider_concurrency: { openai: 1 } },
  ])("admits OpenGateway tasks beyond the generic limit with %j", (config) => {
    // given
    const concurrency = new TaskConcurrency(config)
    const model = "opengateway/openai/gpt"

    // when
    const admitted = Array.from({ length: 32 }, (_, index) =>
      concurrency.tryAcquire(model, `gateway-${index}`, 0))

    // then
    expect(admitted.every(Boolean)).toBe(true)
    for (let index = 0; index < admitted.length; index += 1) {
      concurrency.releaseLease(`gateway-${index}`, 0)
    }
    expect(concurrency.getRetainedKeyCounts()).toEqual({ lanes: 0, queues: 0, leases: 0 })
  })

  test("honors an explicit provider cap across OpenGateway models", () => {
    // given
    const concurrency = new TaskConcurrency({ provider_concurrency: { opengateway: 1 } })
    expect(concurrency.tryAcquire("opengateway/openai/gpt", "first", 0)).toBe(true)
    let granted = false

    // when
    const admitted = concurrency.tryAcquire("opengateway/anthropic/claude", "second", 0)
    concurrency.enqueue("opengateway/anthropic/claude", "second", 0, () => { granted = true })

    // then
    expect(admitted).toBe(false)
    expect(granted).toBe(false)
    concurrency.releaseLease("first", 0)
    expect(granted).toBe(true)
    concurrency.releaseLease("second", 0)
  })

  test("honors an explicit model cap without capping other OpenGateway models", () => {
    // given
    const model = "opengateway/openai/gpt"
    const concurrency = new TaskConcurrency({
      default_concurrency: 1,
      provider_concurrency: { opengateway: 0 },
      model_concurrency: { [model]: 1 },
    })
    expect(concurrency.tryAcquire(model, "first", 0)).toBe(true)

    // when
    const sameModel = concurrency.tryAcquire(model, "second", 0)
    const otherModels = ["third", "fourth"].map((id) =>
      concurrency.tryAcquire("opengateway/anthropic/claude", id, 0))

    // then
    expect(sameModel).toBe(false)
    expect(otherModels).toEqual([true, true])
  })

  test("retains the generic cap for other providers", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 1 })
    expect(concurrency.tryAcquire("openai/gpt", "first", 0)).toBe(true)

    // when
    const sameProvider = concurrency.tryAcquire("openai/gpt", "second", 0)
    const gateway = concurrency.tryAcquire("opengateway/openai/gpt", "third", 0)

    // then
    expect(sameProvider).toBe(false)
    expect(gateway).toBe(true)
  })

  test("keeps global admission and queued handoff for uncapped OpenGateway tasks", () => {
    // given
    const model = "opengateway/openai/gpt"
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 2 })
    expect(concurrency.tryAcquire(model, "first", 0)).toBe(true)
    expect(concurrency.tryAcquire(model, "second", 0)).toBe(true)
    let granted = false

    // when
    const admitted = concurrency.tryAcquire(model, "third", 0)
    concurrency.enqueue(model, "third", 0, () => { granted = true })

    // then
    expect(admitted).toBe(false)
    expect(granted).toBe(false)
    concurrency.releaseLease("first", 0)
    expect(granted).toBe(true)
    expect(concurrency.tryAcquire("other/model", "fourth", 0)).toBe(false)
    concurrency.releaseLease("second", 0)
    concurrency.releaseLease("third", 0)
    expect(concurrency.getRetainedKeyCounts()).toEqual({ lanes: 0, queues: 0, leases: 0 })
  })
})
