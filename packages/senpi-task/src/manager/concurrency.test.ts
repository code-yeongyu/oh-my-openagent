import { describe, expect, test } from "bun:test"

import { TaskConcurrency } from "./concurrency"

describe("lease parking", () => {
  const model = "anthropic/claude"
  function holder() {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 1 })
    expect(concurrency.tryAcquire(model, "parent", 0)).toBe(true)
    return concurrency
  }

  test("park frees lane and global room without losing identity; double park is refused", async () => {
    const concurrency = holder()
    const parked = concurrency.park("parent", 0)
    expect(parked).toBeDefined()
    expect(concurrency.park("parent", 0)).toBeUndefined()
    expect(concurrency.tryAcquire(model, "parent", 0)).toBe(false)
    expect(concurrency.hasFreeSlot(model)).toBe(true)
    expect(concurrency.hasFreeSlot("other/model")).toBe(true)
    await concurrency.unpark(parked)
    await concurrency.unpark(parked)
    expect(concurrency.getCount(model)).toBe(1)
  })

  test("#given a released and re-parked epoch #when the earlier token unparks #then the later parking is untouched", async () => {
    const concurrency = holder()
    const stale = concurrency.park("parent", 0)
    expect(stale).toBeDefined()
    // The parent is released while parked, then the SAME epoch acquires and parks again: the token
    // the first parking handed out must not resume - or release - the second one.
    concurrency.releaseLease("parent", 0)
    expect(concurrency.tryAcquire(model, "parent", 0)).toBe(true)
    const current = concurrency.park("parent", 0)
    expect(current).toBeDefined()
    expect(current).not.toBe(stale)

    await concurrency.unpark(stale)

    expect(concurrency.leaseState("parent", 0)).toBe("parked")
    expect(concurrency.getCount(model)).toBe(0)
    await concurrency.unpark(current)
    expect(concurrency.leaseState("parent", 0)).toBe("held")
    expect(concurrency.getCount(model)).toBe(1)
  })

  test("parking grants a queued child and a resumable parent precedes W2-after-unpark", async () => {
    const concurrency = holder()
    const order: string[] = []
    concurrency.enqueue(model, "child", 0, () => order.push("child"))
    const parked = concurrency.park("parent", 0)
    expect(order).toEqual(["child"])
    const resumed = concurrency.unpark(parked).then(() => order.push("parent"))
    concurrency.enqueue(model, "W2", 0, () => order.push("W2"))
    concurrency.releaseLease("child", 0)
    // Synchronous accounting is the assertion: a broken drain grants W2 instead of the parent.
    expect(order).toEqual(["child"])
    await resumed
    expect(order).toEqual(["child", "parent"])
    concurrency.releaseLease("parent", 0)
    expect(order).toEqual(["child", "parent", "W2"])
  })

  test("a waiter enqueued during parking is admitted", () => {
    const concurrency = holder()
    concurrency.park("parent", 0)
    let granted = false
    concurrency.enqueue(model, "W", 0, () => { granted = true })
    concurrency.drain()
    expect(granted).toBe(true)
  })

  test("release while parked drops the identity and later unpark resolves without a lease", async () => {
    const concurrency = holder()
    const parked = concurrency.park("parent", 0)
    concurrency.releaseLease("parent", 0)
    await concurrency.unpark(parked)
    expect(concurrency.leaseState("parent", 0)).toBeUndefined()
    expect(concurrency.hasFreeSlot(model)).toBe(true)
  })

  test("abort while waiting to resume drops the parked entry", async () => {
    const concurrency = holder()
    const parked = concurrency.park("parent", 0)
    concurrency.tryAcquire(model, "child", 0)
    const controller = new AbortController()
    const resumed = concurrency.unpark(parked, controller.signal)
    controller.abort()
    await resumed
    expect(concurrency.leaseState("parent", 0)).toBeUndefined()
    concurrency.releaseLease("child", 0)
    expect(concurrency.hasFreeSlot(model)).toBe(true)
  })

  test("promotion overflow resumes once while the child holds the only slot", async () => {
    const concurrency = holder()
    const parked = concurrency.park("parent", 0)
    concurrency.tryAcquire(model, "child", 0)
    await concurrency.unpark(parked, undefined, { overflow: true })
    await concurrency.unpark(parked, undefined, { overflow: true })
    expect(concurrency.getCount(model)).toBe(2)
    concurrency.releaseLease("child", 0)
    expect(concurrency.getCount(model)).toBe(1)
    concurrency.releaseLease("parent", 0)
    expect(concurrency.hasFreeSlot(model)).toBe(true)
  })
})

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

  test("#given a zero limit at each precedence level #when resolving the limit #then zero means unbounded", () => {
    // given
    const byDefault = new TaskConcurrency({ default_concurrency: 0 })
    const byProvider = new TaskConcurrency({ default_concurrency: 1, provider_concurrency: { anthropic: 0 } })
    const byModel = new TaskConcurrency({
      default_concurrency: 1,
      provider_concurrency: { anthropic: 1 },
      model_concurrency: { "anthropic/opus": 0 },
    })

    // when
    const limits = [
      byDefault.getLimit("anthropic/claude"),
      byProvider.getLimit("anthropic/claude"),
      byModel.getLimit("anthropic/opus"),
    ]

    // then
    expect(limits).toEqual([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ])
  })

  test("#given a zero default limit #when many tasks acquire #then slots never fill and nothing queues", () => {
    // given
    const concurrency = new TaskConcurrency({ default_concurrency: 0 })

    // when
    for (let index = 0; index < 32; index += 1) concurrency.acquire("anthropic/claude", `st_0000000${index}`)

    // then
    expect(concurrency.hasFreeSlot("anthropic/claude")).toBe(true)
    expect(concurrency.getCount("anthropic/claude")).toBe(0)
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

  test("#given a global cap of two #when two free lanes acquire #then a third lane is blocked", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 2 })
    concurrency.acquire("anthropic/claude", "st_00000001")
    concurrency.acquire("openai/gpt", "st_00000002")
    expect(concurrency.hasFreeSlot("google/gemini")).toBe(false)
  })

  test("#given global zero #when lanes acquire #then only lane limits apply", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 0 })
    expect(concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)).toBe(true)
    expect(concurrency.tryAcquire("anthropic/claude", "st_00000002", 0)).toBe(false)
    expect(concurrency.tryAcquire("openai/gpt", "st_00000003", 0)).toBe(true)
  })

  test("#given an infinite lane and one global slot #when it acquires #then it consumes the slot", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 0, global_concurrency: 1 })
    expect(concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)).toBe(true)
    expect(concurrency.tryAcquire("openai/gpt", "st_00000002", 0)).toBe(false)
  })

  test("#given a lane B waiter #when lane A releases the global slot #then B is granted", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 1 })
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)
    let granted = false
    concurrency.enqueue("openai/gpt", "st_00000002", 0, () => { granted = true })
    concurrency.releaseLease("st_00000001", 0)
    expect(granted).toBe(true)
  })

  test("#given queued lanes #when a slot frees #then the oldest eligible head wins", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 1 })
    concurrency.tryAcquire("google/gemini", "st_00000001", 0)
    const order: string[] = []
    concurrency.enqueue("anthropic/claude", "st_dummy", 0, () => {})
    concurrency.enqueue("openai/gpt", "st_00000002", 0, () => order.push("openai"))
    concurrency.enqueue("anthropic/claude", "st_00000003", 0, () => order.push("anthropic"))
    concurrency.remove("anthropic/claude", "st_dummy")
    concurrency.releaseLease("st_00000001", 0)
    expect(order).toEqual(["openai"])
  })

  test("#given a blocked head on A and an eligible head on B #when a slot frees #then B is granted", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 2 })
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)
    concurrency.tryAcquire("google/gemini", "st_00000002", 0)
    let granted = false
    concurrency.enqueue("anthropic/claude", "st_00000003", 0, () => {})
    concurrency.enqueue("openai/gpt", "st_00000004", 0, () => { granted = true })
    concurrency.releaseLease("st_00000002", 0)
    expect(granted).toBe(true)
  })

  test("#given a queued waiter #when removed #then lane and global counts stay unchanged", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 1 })
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)
    concurrency.enqueue("openai/gpt", "st_00000002", 0, () => {})
    expect(concurrency.remove("openai/gpt", "st_00000002")).toBe(true)
    expect(concurrency.getCount("anthropic/claude")).toBe(1)
    expect(concurrency.getCount("openai/gpt")).toBe(0)
    expect(concurrency.tryAcquire("google/gemini", "st_00000003", 0)).toBe(false)
  })

  test("#given a blocked acquisition #when tryAcquire fails #then counts remain unchanged", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 1, global_concurrency: 1 })
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)
    expect(concurrency.tryAcquire("anthropic/claude", "st_00000002", 0)).toBe(false)
    expect(concurrency.getCount("anthropic/claude")).toBe(1)
    concurrency.releaseLease("st_00000001", 0)
    expect(concurrency.tryAcquire("openai/gpt", "st_00000003", 0)).toBe(true)
  })

  test("#given a queued lane #when tryAcquire runs #then it refuses to bypass the queue", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 2 })
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 0)
    concurrency.enqueue("anthropic/claude", "st_00000002", 0, () => {})
    expect(concurrency.tryAcquire("anthropic/claude", "st_00000003", 0)).toBe(false)
    expect(concurrency.getCount("anthropic/claude")).toBe(1)
  })

  test("#given a newer lease #when an older epoch releases #then the newer lease remains", () => {
    const concurrency = new TaskConcurrency({ default_concurrency: 2 })
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 1)
    concurrency.releaseLease("st_00000001", 1)
    concurrency.tryAcquire("anthropic/claude", "st_00000001", 2)
    concurrency.releaseLease("st_00000001", 1)
    expect(concurrency.getCount("anthropic/claude")).toBe(1)
    concurrency.releaseLease("st_00000001", 2)
    expect(concurrency.getCount("anthropic/claude")).toBe(0)
  })

  test("#given 64 waiters across 16 lanes #when each lane drains #then every grant is deterministic and empty", () => {
    const config = { default_concurrency: 1, global_concurrency: 16 }
    const concurrency = new TaskConcurrency(config)
    const granted: string[] = []
    for (let lane = 0; lane < 16; lane += 1) {
      const model = `provider-${lane}/model`
      concurrency.tryAcquire(model, `holder-${lane}`, 0)
      for (let waiter = 0; waiter < 4; waiter += 1) {
        const taskId = `task-${lane}-${waiter}`
        concurrency.enqueue(model, taskId, 0, () => granted.push(taskId))
      }
    }
    for (let lane = 0; lane < 16; lane += 1) {
      const model = `provider-${lane}/model`
      for (let release = 0; release < 5; release += 1) concurrency.release(model)
      expect(concurrency.getCount(model)).toBe(0)
      expect(concurrency.queuePosition(model, `task-${lane}-0`)).toBeUndefined()
    }
    expect(granted).toHaveLength(64)
    expect(granted).toEqual([...Array(16)].flatMap((_, lane) => [...Array(4)].map((__, waiter) => `task-${lane}-${waiter}`)))
    expect(concurrency.getRetainedKeyCounts()).toEqual({ lanes: 0, queues: 0, leases: 0 })
  })
})
