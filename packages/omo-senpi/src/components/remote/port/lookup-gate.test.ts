import { describe, expect, test } from "bun:test"
import type { RemoteLookupOutcome } from "../../thread/remote/ports"
import { createLookupGate, type LookupStart } from "./lookup-gate"

// #14748: the lookup gate's interleavings. Each locate is a fake the test finishes by hand: `capped` devices answer
// silent at once while their locate keeps running, as a lookup the client capped does.

type Options = {
  readonly capped?: readonly string[]
  readonly rejects?: readonly string[]
  readonly throws?: string
  readonly fenceWaitMs?: number
}

function locates(options: Options = {}) {
  let inFlight = 0
  const started: Array<{ readonly device: string; readonly inFlight: number }> = []
  const finishers = new Map<string, () => void>()
  const start = (device: string): LookupStart => {
    if (options.throws === device) throw new Error(`start failed for ${device}`)
    inFlight += 1
    started.push({ device, inFlight })
    let finish: () => void = () => {}
    const settled = new Promise<void>((resolve, reject) => {
      finish = () => {
        inFlight -= 1
        if (options.rejects?.includes(device) === true) reject(new Error("locate failed"))
        else resolve()
      }
    })
    finishers.set(device, finish)
    const answer: Promise<RemoteLookupOutcome> =
      options.capped?.includes(device) === true
        ? Promise.resolve({ kind: "silent", reason: "lookup_timeout" })
        : settled.then(
            () => ({ kind: "found", key: `key-${device}` }),
            () => ({ kind: "silent", reason: "locate_failed" }),
          )
    return { answer, settled }
  }
  const startedDevices = () => started.map((entry) => entry.device)
  return {
    gate: createLookupGate(start, options.fenceWaitMs ?? 5_000),
    started,
    startedDevices,
    finish: (device: string) => finishers.get(device)?.(),
  }
}

/** Yields until `condition` holds; a circuit breaker, never a synchronizer: it fails loudly after 1,000 turns. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 1_000; turn += 1) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error(`waited 1000 microtask turns for ${what}`)
}

const turns = async (count: number) => {
  for (let turn = 0; turn < count; turn += 1) await Promise.resolve()
}

describe("#14748 the lookup gate: a solo lookup is never in flight with another locate", () => {
  test("E16: #given two callers asking alone at once #then their locates run one after the other", async () => {
    const run = locates()
    const first = run.gate.lookupAlone("c", "id", 5_000)
    const second = run.gate.lookupAlone("d", "id", 5_000)
    await until(() => run.startedDevices().includes("c"), "c to start")
    await turns(20)
    expect(run.startedDevices()).toEqual(["c"])
    run.finish("c")
    await until(() => run.startedDevices().includes("d"), "d to start")
    run.finish("d")
    expect(await Promise.all([first, second])).toEqual([
      { kind: "found", key: "key-c" },
      { kind: "found", key: "key-d" },
    ])
    expect(run.started.map((entry) => entry.inFlight)).toEqual([1, 1])
  })

  test("E17/E31: #given an earlier locate still running past its cap #then a solo lookup starts only once it finished", async () => {
    const run = locates({ capped: ["b"] })
    expect(await run.gate.lookup("b", "id")).toEqual({ kind: "silent", reason: "lookup_timeout" })
    const alone = run.gate.lookupAlone("c", "id", 5_000)
    await turns(20)
    expect(run.startedDevices()).toEqual(["b"])
    run.finish("b")
    await until(() => run.startedDevices().includes("c"), "c to start")
    run.finish("c")
    expect(await alone).toEqual({ kind: "found", key: "key-c" })
    expect(run.started.find((entry) => entry.device === "c")?.inFlight).toBe(1)
  })

  test("E18: #given a solo lookup in flight #when a plain lookup is asked #then it starts only after the solo one answered", async () => {
    const run = locates()
    const alone = run.gate.lookupAlone("c", "id", 5_000)
    await until(() => run.startedDevices().includes("c"), "c to start")
    const plain = run.gate.lookup("e", "id")
    await turns(20)
    expect(run.startedDevices()).toEqual(["c"])
    run.finish("c")
    await until(() => run.startedDevices().includes("e"), "e to start")
    run.finish("e")
    expect(await Promise.all([alone, plain])).toEqual([
      { kind: "found", key: "key-c" },
      { kind: "found", key: "key-e" },
    ])
  })

  test("E19: #given an earlier locate that does not finish within waitMs #then the solo lookup sends nothing, answers undefined and holds nothing back", async () => {
    const run = locates({ capped: ["b"] })
    await run.gate.lookup("b", "id")
    expect(await run.gate.lookupAlone("c", "id", 30)).toBeUndefined()
    expect(run.startedDevices()).toEqual(["b"])
    const plain = run.gate.lookup("e", "id")
    await until(() => run.startedDevices().includes("e"), "e to start")
    run.finish("e")
    expect(await plain).toEqual({ kind: "found", key: "key-e" })
  })

  test("E20: #given a solo lookup that gave up waiting for its turn #then the next one still waits for the solo lookup before it", async () => {
    const run = locates()
    const first = run.gate.lookupAlone("a", "id", 5_000)
    await until(() => run.startedDevices().includes("a"), "a to start")
    expect(await run.gate.lookupAlone("b", "id", 30)).toBeUndefined()
    const third = run.gate.lookupAlone("c", "id", 5_000)
    await turns(20)
    expect(run.startedDevices()).toEqual(["a"])
    run.finish("a")
    await until(() => run.startedDevices().includes("c"), "c to start")
    run.finish("c")
    expect(await Promise.all([first, third])).toEqual([
      { kind: "found", key: "key-a" },
      { kind: "found", key: "key-c" },
    ])
    expect(run.startedDevices()).not.toContain("b")
  })

  test("E21: #given an earlier locate that fails #then the solo lookup still proceeds once it ended", async () => {
    const run = locates({ capped: ["b"], rejects: ["b"] })
    await run.gate.lookup("b", "id")
    const alone = run.gate.lookupAlone("c", "id", 5_000)
    run.finish("b")
    await until(() => run.startedDevices().includes("c"), "c to start")
    run.finish("c")
    expect(await alone).toEqual({ kind: "found", key: "key-c" })
  })

  test("E28: #given the wall clock jumps back while a solo lookup waits #then it still gives up after waitMs", async () => {
    const run = locates({ capped: ["b"] })
    await run.gate.lookup("b", "id")
    const realNow = Date.now
    let reads = 0
    Date.now = () => (reads++ === 0 ? realNow() : realNow() - 3_600_000)
    try {
      const started = performance.now()
      expect(await run.gate.lookupAlone("c", "id", 50)).toBeUndefined()
      expect(performance.now() - started).toBeLessThan(2_000)
    } finally {
      Date.now = realNow
    }
  })

  test("E29: #given nothing in flight #when asked alone with no time to wait #then it sends at once", async () => {
    const run = locates()
    const alone = run.gate.lookupAlone("c", "id", 0)
    await until(() => run.startedDevices().includes("c"), "c to start")
    run.finish("c")
    expect(await alone).toEqual({ kind: "found", key: "key-c" })
  })

  test("E32: #given a locate that cannot be started #then the solo lookup fails and holds nothing back", async () => {
    const run = locates({ throws: "c" })
    await expect(run.gate.lookupAlone("c", "id", 5_000)).rejects.toThrow("start failed for c")
    const plain = run.gate.lookup("e", "id")
    await until(() => run.startedDevices().includes("e"), "e to start")
    run.finish("e")
    expect(await plain).toEqual({ kind: "found", key: "key-e" })
  })

  test("E40: #given a solo lookup answered at its cap while its locate still runs #when a plain lookup is asked #then it starts only once that locate settled (review round 4)", async () => {
    const run = locates({ capped: ["c"] })
    expect(await run.gate.lookupAlone("c", "id", 5_000)).toEqual({ kind: "silent", reason: "lookup_timeout" })
    const plain = run.gate.lookup("e", "id")
    await turns(20)
    expect(run.startedDevices()).toEqual(["c"])
    run.finish("c")
    await until(() => run.startedDevices().includes("e"), "e to start")
    run.finish("e")
    expect(await plain).toEqual({ kind: "found", key: "key-e" })
    expect(run.started.find((entry) => entry.device === "e")?.inFlight).toBe(1)
  })

  test("E41: #given a capped solo locate that is cancelled (rejects) afterwards #then the fence opens and a waiting lookup proceeds", async () => {
    const run = locates({ capped: ["c"], rejects: ["c"] })
    await run.gate.lookupAlone("c", "id", 5_000)
    const plain = run.gate.lookup("e", "id")
    await turns(20)
    expect(run.startedDevices()).toEqual(["c"])
    run.finish("c")
    await until(() => run.startedDevices().includes("e"), "e to start")
    run.finish("e")
    expect(await plain).toEqual({ kind: "found", key: "key-e" })
  })

  test("E42: #given a capped solo locate that never settles #when a plain lookup meets the closed fence #then it answers silent at its own cap and sends nothing", async () => {
    const run = locates({ capped: ["c"], fenceWaitMs: 30 })
    await run.gate.lookupAlone("c", "id", 5_000)
    expect(await run.gate.lookup("e", "id")).toEqual({ kind: "silent", reason: "lookup_timeout" })
    expect(run.startedDevices()).toEqual(["c"])
  })

  test("E43: #given a capped solo lookup #when the next caller asks alone #then its locate starts only once the first one's locate settled", async () => {
    const run = locates({ capped: ["c"] })
    await run.gate.lookupAlone("c", "id", 5_000)
    const next = run.gate.lookupAlone("d", "id", 5_000)
    await turns(20)
    expect(run.startedDevices()).toEqual(["c"])
    run.finish("c")
    await until(() => run.startedDevices().includes("d"), "d to start")
    run.finish("d")
    expect(await next).toEqual({ kind: "found", key: "key-d" })
    expect(run.started.map((entry) => entry.inFlight)).toEqual([1, 1])
  })

  test("E44: #given a capped solo lookup whose locate still runs #when another locate is admitted (post-create, attach, watch recovery) #then it is dispatched only once the solo locate settled (review round 5)", async () => {
    const run = locates({ capped: ["c"] })
    await run.gate.lookupAlone("c", "id", 5_000)
    let dispatched = false
    const admitted = run.gate.admit(async () => {
      dispatched = true
      return "key-x"
    })
    await turns(20)
    expect(dispatched).toBe(false)
    run.finish("c")
    expect(await admitted).toBe("key-x")
    expect(dispatched).toBe(true)
  })

  test("E45: #given an admitted locate still in flight #when a caller asks alone #then the solo locate waits for it", async () => {
    const run = locates()
    let finishOther: () => void = () => {}
    const other = run.gate.admit(() => new Promise<void>((resolve) => (finishOther = resolve)))
    const alone = run.gate.lookupAlone("c", "id", 5_000)
    await turns(20)
    expect(run.startedDevices()).toEqual([])
    finishOther()
    await other
    await until(() => run.startedDevices().includes("c"), "c to start")
    run.finish("c")
    expect(await alone).toEqual({ kind: "found", key: "key-c" })
  })

  test("E46: #given a capped solo locate that never settles #when another locate is admitted #then it is refused after one lookup cap and never dispatched (review round 6)", async () => {
    const run = locates({ capped: ["c"], fenceWaitMs: 30 })
    await run.gate.lookupAlone("c", "id", 5_000)
    let dispatched = false
    await expect(
      run.gate.admit(async () => {
        dispatched = true
      }),
    ).rejects.toThrow("lookup_fence_timeout")
    expect(dispatched).toBe(false)
  })
})

// Review round 6: every pair of gate operations, the second started after each number of microtask turns, so every await
// point of the first is crossed. At every locate start the fake checks the two isolation rules: a solo locate starts with
// nothing in flight, and nothing starts while a solo locate runs. Solo devices are named s*, everything else is plain.
type Op = "solo" | "lookup" | "admit"

async function interleave(first: Op, second: Op, offset: number): Promise<readonly string[]> {
  const violations: string[] = []
  const running = new Map<string, () => void>()
  let soloRunning = 0
  const begin = (device: string) => {
    const solo = device.startsWith("s")
    if (solo && running.size > 0) violations.push(`${device} started with ${[...running.keys()].join(",")} in flight`)
    if (!solo && soloRunning > 0) violations.push(`${device} started while a solo locate ran`)
    if (solo) soloRunning += 1
    let finish: () => void = () => {}
    const settled = new Promise<void>((resolve) => {
      finish = () => {
        running.delete(device)
        if (solo) soloRunning -= 1
        resolve()
      }
    })
    running.set(device, finish)
    return settled
  }
  const gate = createLookupGate((device) => {
    const settled = begin(device)
    return { answer: settled.then(() => ({ kind: "found" as const, key: `key-${device}` })), settled }
  }, 5_000)
  const run = (op: Op, name: string): Promise<unknown> =>
    op === "solo"
      ? gate.lookupAlone(`s${name}`, "id", 5_000)
      : op === "lookup"
        ? gate.lookup(`p${name}`, "id")
        : gate.admit(() => begin(`a${name}`))
  const a = run(first, "1")
  await turns(offset)
  const b = run(second, "2")
  let done = false
  const both = Promise.all([a, b]).then(() => (done = true))
  for (let round = 0; round < 200 && !done; round += 1) {
    await turns(5)
    for (const finish of [...running.values()]) finish()
  }
  await both
  return violations
}

describe("#14748 review round 6: gate admission is atomic under every interleaving", () => {
  const pairs: ReadonlyArray<readonly [Op, Op]> = [
    ["lookup", "solo"],
    ["solo", "lookup"],
    ["admit", "solo"],
    ["solo", "admit"],
    ["admit", "admit"],
    ["solo", "solo"],
    ["lookup", "admit"],
  ]
  test.each(pairs)(
    "#given %s then %s at every microtask offset #then no solo locate ever overlaps another locate",
    async (first, second) => {
      for (let offset = 0; offset <= 15; offset += 1)
        expect({ offset, violations: await interleave(first, second, offset) }).toEqual({ offset, violations: [] })
    },
  )
})
