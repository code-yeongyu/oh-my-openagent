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

  describe("remove (queued-task dequeue)  w2conc ", () => {
    test(" w2conc  #given an enqueued waiter #when removed #then its queuePosition becomes undefined", () => {
      // given
      const concurrency = new TaskConcurrency({ default_concurrency: 1 })
      concurrency.acquire("anthropic/claude", "st_00000001")
      concurrency.enqueue("anthropic/claude", "st_00000002", () => {})
      expect(concurrency.queuePosition("anthropic/claude", "st_00000002")).toBe(1)

      // when
      const removed = concurrency.remove("anthropic/claude", "st_00000002")

      // then
      expect(removed).toBe(true)
      expect(concurrency.queuePosition("anthropic/claude", "st_00000002")).toBeUndefined()
    })

    test(" w2conc  #given three queued waiters #when the middle is removed #then survivors renumber (third drops 3 to 2)", () => {
      // given
      const concurrency = new TaskConcurrency({ default_concurrency: 1 })
      concurrency.acquire("anthropic/claude", "st_00000001")
      concurrency.enqueue("anthropic/claude", "st_00000002", () => {})
      concurrency.enqueue("anthropic/claude", "st_00000003", () => {})
      concurrency.enqueue("anthropic/claude", "st_00000004", () => {})
      expect(concurrency.queuePosition("anthropic/claude", "st_00000004")).toBe(3)

      // when
      const removed = concurrency.remove("anthropic/claude", "st_00000003")

      // then
      expect(removed).toBe(true)
      expect(concurrency.queuePosition("anthropic/claude", "st_00000002")).toBe(1)
      expect(concurrency.queuePosition("anthropic/claude", "st_00000004")).toBe(2)
    })

    test(" w2conc  #given head waiter removed #when release fires #then it grants the next survivor not the removed one", () => {
      // given
      const concurrency = new TaskConcurrency({ default_concurrency: 1 })
      concurrency.acquire("anthropic/claude", "st_00000001")
      let headGranted = false
      let survivorGranted = false
      concurrency.enqueue("anthropic/claude", "st_00000002", () => {
        headGranted = true
      })
      concurrency.enqueue("anthropic/claude", "st_00000003", () => {
        survivorGranted = true
      })

      // when
      concurrency.remove("anthropic/claude", "st_00000002")
      concurrency.release("anthropic/claude")

      // then
      expect(headGranted).toBe(false)
      expect(survivorGranted).toBe(true)
    })

    test(" w2conc  #given no such queued task #when remove called #then it returns false (safe no-op)", () => {
      // given
      const concurrency = new TaskConcurrency({ default_concurrency: 1 })
      concurrency.acquire("anthropic/claude", "st_00000001")
      concurrency.enqueue("anthropic/claude", "st_00000002", () => {})

      // when
      const removed = concurrency.remove("anthropic/claude", "st_99999999")

      // then
      expect(removed).toBe(false)
      expect(concurrency.queuePosition("anthropic/claude", "st_00000002")).toBe(1)
    })

    test(" w2conc  #given an acquired slot #when a queued waiter is removed #then getCount is unchanged", () => {
      // given
      const concurrency = new TaskConcurrency({ default_concurrency: 1 })
      concurrency.acquire("anthropic/claude", "st_00000001")
      concurrency.enqueue("anthropic/claude", "st_00000002", () => {})
      expect(concurrency.getCount("anthropic/claude")).toBe(1)

      // when
      concurrency.remove("anthropic/claude", "st_00000002")

      // then
      expect(concurrency.getCount("anthropic/claude")).toBe(1)
    })

    test(" w2conc  #given three waiters one removed #when release drains #then both survivors grant in FIFO and removed never grants", () => {
      // given
      const concurrency = new TaskConcurrency({ default_concurrency: 1 })
      concurrency.acquire("anthropic/claude", "st_00000001")
      const granted: string[] = []
      concurrency.enqueue("anthropic/claude", "st_00000002", () => granted.push("second"))
      concurrency.enqueue("anthropic/claude", "st_00000003", () => granted.push("third"))
      concurrency.enqueue("anthropic/claude", "st_00000004", () => granted.push("fourth"))

      // when
      concurrency.remove("anthropic/claude", "st_00000003")
      concurrency.release("anthropic/claude")
      concurrency.release("anthropic/claude")

      // then
      expect(granted).toEqual(["second", "fourth"])
    })
  })
})
