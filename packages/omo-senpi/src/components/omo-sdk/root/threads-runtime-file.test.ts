import { describe, expect, test } from "bun:test"

import { UNEXPECTED_LOG_UNWRITTEN, unexpectedLogNamed } from "../unexpected-port"
import { RUNTIME_STAMP } from "../runtime-stamp"
import { CORE_CALLS, RUNTIME_FILE_MISMATCH, RUNTIME_FILE_UNAVAILABLE, type ThreadsRuntime } from "./thread-runtime-file"
import { ROOT_DISPOSED } from "./assemble"
import { threadsNamespace } from "./threads"

// Slice P1c (#15031): the thread core is its own runtime file, loaded on the first thread call through one import the
// root is given. These cases drive that import directly (an injected function, never a module mock or a timer).

const EXCEPTION_TEXT = "ENOENT: no such file or directory, open '/opt/plugin/runtime/omo-sdk/threads.js'"

function namespace(load: () => Promise<ThreadsRuntime>, onUnexpected?: (error: unknown) => unknown) {
  return threadsNamespace({
    agentDir: "/agent-dir-never-read",
    cwd: "/cwd-never-read",
    uid: 501,
    user: "probe",
    env: {},
    principal: { kind: "script", uid: 501 },
    loadThreadsRuntime: load,
    ...(onUnexpected === undefined ? {} : { ports: { onUnexpected } }),
  })
}

function failingLoad() {
  const calls: number[] = []
  const load = () => {
    calls.push(calls.length)
    return Promise.reject(new Error(EXCEPTION_TEXT))
  }
  return { calls, load }
}

// A core with every member the root calls, each answering an empty success; a case overrides the members it drives.
function fullCore(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const answer = async () => ({ kind: "ok", threads: [], thread: { thread_id: "t" } })
  return {
    ...Object.fromEntries(
      [
        "list",
        "read",
        "send",
        "locate",
        "create",
        "interrupt",
        "close",
        "rename",
        "setModel",
        "release",
        "releaseRow",
        "warm",
        "dispose",
      ].map((name) => [name, answer]),
    ),
    release: async () => ({ kind: "ok", value: { success: true } }),
    extensions: { register: answer, call: answer },
    ...overrides,
  }
}

function runtimeWith(list: () => unknown): ThreadsRuntime {
  return {
    RUNTIME_STAMP,
    createThreadCore: (() => fullCore({ list })) as unknown as ThreadsRuntime["createThreadCore"],
    fail: ((code: string, message: string, next_action: string) => ({
      kind: "error",
      error: { code, message, next_action },
    })) as unknown as ThreadsRuntime["fail"],
    threadToolParamSchemas: {
      thread_create: { properties: {} },
    } as unknown as ThreadsRuntime["threadToolParamSchemas"],
  }
}

const callMember = (served: ReturnType<typeof namespace>, member: string) =>
  (served.members as Readonly<Record<string, (input?: unknown) => Promise<unknown>>>)[member] as (
    input?: unknown,
  ) => Promise<unknown>

const list = (served: ReturnType<typeof namespace>) =>
  (served.members["threads.list"] as (input?: unknown) => Promise<unknown>)({})

describe("the thread runtime file loads on the first thread call", () => {
  test("#given a root that makes no thread call #then the thread runtime file is never loaded", () => {
    const { calls, load } = failingLoad()
    namespace(load)
    expect(calls).toEqual([])
  })

  test("#given the thread runtime file loaded once #when two thread calls run #then it is loaded once", async () => {
    let loads = 0
    const runtime = runtimeWith(() => ({ kind: "ok", threads: [] }))
    const served = namespace(() => {
      loads += 1
      return Promise.resolve(runtime)
    })
    await list(served)
    await list(served)
    expect(loads).toBe(1)
  })
})

describe("a thread runtime file that cannot load answers a typed refusal", () => {
  test("#given no logger port #when the load fails #then every thread call answers internal_error naming the file by its logical name only", async () => {
    const { load } = failingLoad()
    const answer = (await list(namespace(load))) as { kind: string; error: Record<string, unknown> }
    expect(answer.kind).toBe("error")
    expect(answer.error.code).toBe("internal_error")
    expect(answer.error.details).toEqual({ reason: RUNTIME_FILE_UNAVAILABLE, file: "threads" })
    expect(JSON.stringify(answer)).not.toContain("ENOENT")
    expect(JSON.stringify(answer)).not.toContain("threads.js")
    expect(JSON.stringify(answer)).not.toContain("#omo-sdk-threads-runtime")
  })

  test("#given a logger port that wrote the details to a file #when the load fails #then the exception reaches the port alone and the message names that file", async () => {
    const { load } = failingLoad()
    const seen: unknown[] = []
    const answer = (await list(
      namespace(load, (error) => {
        seen.push(error)
        return "/agent/logs/unexpected.log"
      }),
    )) as { error: { message: string } }
    expect(seen).toHaveLength(1)
    expect(String(seen[0])).toContain(EXCEPTION_TEXT)
    expect(answer.error.message.endsWith(unexpectedLogNamed("/agent/logs/unexpected.log"))).toBe(true)
    expect(JSON.stringify(answer)).not.toContain("ENOENT")
  })

  test("#given a logger port that keeps a file it could not write #when the load fails #then the message says the details were not written", async () => {
    const { load } = failingLoad()
    const answer = (await list(namespace(load, () => false))) as { error: { message: string } }
    expect(answer.error.message.endsWith(UNEXPECTED_LOG_UNWRITTEN)).toBe(true)
  })

  test("#given a logger port that throws #when the load fails #then the answer is the same typed refusal", async () => {
    const { load } = failingLoad()
    const answer = (await list(
      namespace(load, () => {
        throw new Error("the sink itself failed")
      }),
    )) as { error: { code: string; details: unknown } }
    expect(answer.error.code).toBe("internal_error")
    expect(answer.error.details).toEqual({ reason: RUNTIME_FILE_UNAVAILABLE, file: "threads" })
  })

  test("#given a load that failed #when the next thread call runs #then it loads again and reaches the thread core (P1c retry contract)", async () => {
    let loads = 0
    let reached = 0
    const runtime = runtimeWith(() => {
      reached += 1
      return { kind: "ok", threads: [] }
    })
    const served = namespace(() => {
      loads += 1
      return loads === 1 ? Promise.reject(new Error(EXCEPTION_TEXT)) : Promise.resolve(runtime)
    })
    await list(served)
    await list(served)
    expect({ loads, reached }).toEqual({ loads: 2, reached: 1 })
  })
})

// Review 6075851574 HIGH 2: the pending creation is the namespace's from the first call on, so a dispose that races the
// first load waits for it and disposes what it built; a load that fails leaves nothing but the caller's ports to release.
describe("a dispose that races the first thread call", () => {
  // The load is held open, and the test disposes only once the call has asked for it: the signal, never a timer.
  function held() {
    let release: (runtime: ThreadsRuntime) => void = () => undefined
    let reject: (error: Error) => void = () => undefined
    let asked: () => void = () => undefined
    const loading = new Promise<void>((resolve) => {
      asked = resolve
    })
    const pending = new Promise<ThreadsRuntime>((resolve, fail) => {
      release = resolve
      reject = fail
    })
    const load = () => {
      asked()
      return pending
    }
    return { load, loading, release, reject }
  }
  function countingRuntime() {
    const counts = { created: 0, disposed: 0 }
    const runtime: ThreadsRuntime = {
      ...runtimeWith(() => ({ kind: "ok", threads: [] })),
      createThreadCore: (() => {
        counts.created += 1
        return fullCore({
          dispose: async () => {
            counts.disposed += 1
          },
        })
      }) as unknown as ThreadsRuntime["createThreadCore"],
    }
    return { counts, runtime }
  }

  // Review 6076881626 HIGH: every member, whatever it awaits before the core (threads.create reads the file's schemas
  // first), leaves no core a dispose did not reach.
  for (const member of Object.keys(namespace(() => Promise.resolve(runtimeWith(() => undefined))).members))
    test(`#given a first load held open #when ${member} runs, dispose runs and the load then succeeds #then every core built is disposed`, async () => {
      const gate = held()
      const { counts, runtime } = countingRuntime()
      const served = namespace(gate.load)
      const call = callMember(served, member)(MEMBER_INPUTS[member] ?? {}).catch((error: unknown) => error)
      await gate.loading
      const disposed = served.dispose?.()
      gate.release(runtime)
      const [answer] = await Promise.all([call, disposed])
      expect({ created: counts.created, disposed: counts.disposed, answer }).toEqual({
        created: 0,
        disposed: 0,
        answer: { kind: "error", error: ROOT_DISPOSED },
      })
    })

  // Architecture contract (the design lane's ruling on review 6076881626): the runtime file is loaded on ONE path, the
  // one that registers the pending creation and observes disposal, so no call site can reach it around a dispose.
  test("#given the thread runtime file's boundary source #then the runtime file's loader has exactly one caller", async () => {
    const source = await Bun.file(new URL("./thread-runtime-file.ts", import.meta.url)).text()
    expect(source.match(/\bloadRuntime\(\)/g)?.length).toBe(1)
  })

  // Dispose wins, the whole class (design ruling on reviews 6081000144 and 6081179233): every outcome of the creation
  // against every moment dispose() can land answers the shared ROOT_DISPOSED, every core built is disposed (created ==
  // disposed), and the caller's store is released exactly once (by the core when one was built, by the namespace when
  // none was). A load-stage outcome has no construction or ready moment, so 16 of the 24 cells exist.
  type Gate = ReturnType<typeof held>
  type Stage = "load" | "construct"
  type Harness = {
    readonly loadGate: Gate
    readonly constructing: Promise<void>
    readonly finish: (core: unknown) => void
    readonly fail: (error: Error) => void
    readonly makeCore: () => unknown
    readonly constructRuntime: ThreadsRuntime
  }
  const OUTCOMES: Readonly<Record<string, { readonly stage: Stage; readonly settle: (harness: Harness) => void }>> = {
    "the file is missing": { stage: "load", settle: (h) => h.loadGate.reject(new Error(EXCEPTION_TEXT)) },
    "the file is from another build": {
      stage: "load",
      settle: (h) =>
        h.loadGate.release({ ...runtimeWith(() => undefined), RUNTIME_STAMP: "another-build" } as ThreadsRuntime),
    },
    "the file has a misshapen export": {
      stage: "load",
      settle: (h) =>
        h.loadGate.release({
          ...runtimeWith(() => undefined),
          threadToolParamSchemas: [],
        } as unknown as ThreadsRuntime),
    },
    "the core cannot be built": { stage: "construct", settle: (h) => h.fail(new Error(CONSTRUCTION_TEXT)) },
    "the built core is misshapen": { stage: "construct", settle: (h) => h.finish({}) },
    "the core is built": { stage: "construct", settle: (h) => h.finish(h.makeCore()) },
  }
  const MOMENTS = ["before the load", "during the load", "during the construction", "after the core is ready"] as const
  const exists = (stage: Stage, moment: (typeof MOMENTS)[number], outcome: string) =>
    moment === "before the load" ||
    moment === "during the load" ||
    (moment === "during the construction" && stage === "construct") ||
    (moment === "after the core is ready" && outcome === "the core is built")

  function harness() {
    const counts = { created: 0, disposed: 0, store: 0 }
    const loadGate = held()
    let constructed: () => void = () => undefined
    const constructing = new Promise<void>((resolve) => {
      constructed = resolve
    })
    let finish: (core: unknown) => void = () => undefined
    let fail: (error: Error) => void = () => undefined
    const built = new Promise<unknown>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    const store = {
      dispose: async () => {
        counts.store += 1
      },
    }
    // A built core owns the caller's store, as the real one does: its dispose releases it.
    const makeCore = () => {
      counts.created += 1
      return fullCore({
        dispose: async () => {
          counts.disposed += 1
          await store.dispose()
        },
      })
    }
    const constructRuntime = {
      ...runtimeWith(() => undefined),
      createThreadCore: () => {
        constructed()
        return built
      },
    } as unknown as ThreadsRuntime
    const served = threadsNamespace({
      agentDir: "/agent-dir-never-read",
      cwd: "/cwd-never-read",
      uid: 501,
      user: "probe",
      env: {},
      principal: { kind: "script", uid: 501 },
      loadThreadsRuntime: loadGate.load,
      ports: { store: store as unknown as NonNullable<Parameters<typeof threadsNamespace>[0]["ports"]>["store"] },
    })
    const h: Harness = { loadGate, constructing, finish, fail, makeCore, constructRuntime }
    return { served, counts, h }
  }

  for (const [outcome, { stage, settle }] of Object.entries(OUTCOMES))
    for (const moment of MOMENTS.filter((candidate) => exists(stage, candidate, outcome)))
      test(`#given ${outcome} #when dispose lands ${moment} #then the call answers ROOT_DISPOSED, every core built is disposed and the store is released once`, async () => {
        const { served, counts, h } = harness()
        let answer: unknown
        if (moment === "before the load") {
          await served.dispose?.()
          answer = await list(served)
        } else if (moment === "during the load") {
          const call = list(served)
          await h.loadGate.loading
          const disposing = served.dispose?.()
          if (stage === "load") settle(h)
          else h.loadGate.release(h.constructRuntime)
          ;[answer] = await Promise.all([call, disposing])
        } else if (moment === "during the construction") {
          const call = list(served)
          h.loadGate.release(h.constructRuntime)
          await h.constructing
          const disposing = served.dispose?.()
          settle(h)
          ;[answer] = await Promise.all([call, disposing])
        } else {
          h.loadGate.release(h.constructRuntime)
          const first = list(served)
          await h.constructing
          settle(h)
          await first
          // threads.locate reaches acquire in the same tick (no input await first), so dispose lands between the ready
          // core and the member running on it.
          const call = callMember(served, "threads.locate")({ thread: "t" })
          const disposing = served.dispose?.()
          ;[answer] = await Promise.all([call, disposing])
        }
        expect({ answer, created: counts.created, disposed: counts.disposed, store: counts.store }).toEqual({
          answer: { kind: "error", error: ROOT_DISPOSED },
          created: counts.disposed,
          disposed: counts.created,
          store: 1,
        })
      })

  // Security review 6081319929, F1, per member: with the construction held, dispose() begun and the core then built, no
  // member of that core ever runs, every member answers ROOT_DISPOSED, and the core is disposed once.
  for (const member of Object.keys(namespace(() => Promise.resolve(runtimeWith(() => undefined))).members))
    test(`#given a core construction held open #when ${member} runs, dispose begins and the core is then built #then it answers ROOT_DISPOSED and no member of that core runs`, async () => {
      const { served, counts, h } = harness()
      const ran: string[] = []
      const recordingCore = () => {
        const core = h.makeCore() as Record<string, unknown>
        return Object.fromEntries(
          Object.entries(core).map(([name, value]) => [
            name,
            name === "dispose" || typeof value !== "function"
              ? value
              : (...args: unknown[]) => {
                  ran.push(name)
                  return (value as (...a: unknown[]) => unknown)(...args)
                },
          ]),
        )
      }
      h.loadGate.release(h.constructRuntime)
      const call = callMember(served, member)(MEMBER_INPUTS[member] ?? {})
      await h.constructing
      const disposing = served.dispose?.()
      h.finish(recordingCore())
      const [answer] = await Promise.all([call, disposing])
      expect({ answer, created: counts.created, disposed: counts.disposed, ran }).toEqual({
        answer: { kind: "error", error: ROOT_DISPOSED },
        created: 1,
        disposed: 1,
        ran: [],
      })
    })

  // Review 6081652829 and the LEAD's ruling, dispose wins by construction: a member reaches the core only through `use`,
  // which checks the disposed mark and calls the core in the same tick. The sweep starts dispose after every number of
  // microtask turns from 0 to N, where N is the turns that member takes to settle on a ready core with no dispose
  // (measured first, so it covers the longest await chain the member has) plus one; no core method may run once
  // dispose() began, and the core is disposed once.
  const watchedCore = (h: Harness, onCall: (name: string) => void) => {
    const watch = (target: Record<string, unknown>, prefix: string): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(target).map(([name, value]) => [
          name,
          name === "dispose"
            ? value
            : typeof value === "function"
              ? (...args: unknown[]) => {
                  onCall(`${prefix}${name}`)
                  return (value as (...a: unknown[]) => unknown)(...args)
                }
              : typeof value === "object" && value !== null
                ? watch(value as Record<string, unknown>, `${prefix}${name}.`)
                : value,
        ]),
      )
    return watch(h.makeCore() as Record<string, unknown>, "")
  }
  const readyNamespace = async (onCall: (name: string) => void) => {
    const { served, counts, h } = harness()
    h.loadGate.release(h.constructRuntime)
    const warm = list(served)
    await h.constructing
    h.finish(watchedCore(h, onCall))
    await warm
    return { served, counts }
  }
  // A step is one microtask turn; a member that awaits I/O (a module import, for the input check) yields to the event
  // loop, so a step that finds no microtask work waits one macrotask tick. The member's settling time counts these steps,
  // so N covers every await it has, microtask or I/O, and the sweep starts dispose after each step from 0 to N + 1.
  // One microtask turn per step (awaiting an already-settled promise takes exactly one), so no one-turn window is skipped.
  const step = () => Promise.resolve()
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
  const stepsToSettle = async (member: string): Promise<number> => {
    const { served } = await readyNamespace(() => undefined)
    let settled = false
    const call = callMember(
      served,
      member,
    )(MEMBER_INPUTS[member] ?? {}).then(() => {
      settled = true
    })
    const bound = 10_000
    let steps = 0
    while (!settled && steps < bound) {
      await (steps % 16 === 15 ? tick() : step())
      steps += 1
    }
    expect({ member, settledWithinBound: settled }).toEqual({ member, settledWithinBound: true })
    await call
    return steps
  }

  for (const member of Object.keys(namespace(() => Promise.resolve(runtimeWith(() => undefined))).members))
    test(`#given a ready core #when ${member} runs and dispose begins after every step up to the member's own settling time #then no core method runs once dispose began`, async () => {
      const longest = await stepsToSettle(member)
      const lateCalls: string[] = []
      for (let steps = 0; steps <= longest + 1; steps += 1) {
        let disposing = false
        const { served, counts } = await readyNamespace((name) => {
          if (disposing) lateCalls.push(`+${steps}: ${name}`)
        })
        const call = callMember(served, member)(MEMBER_INPUTS[member] ?? {})
        for (let taken = 0; taken < steps; taken += 1) await (taken % 16 === 15 ? tick() : step())
        disposing = true
        await Promise.all([call, served.dispose?.()])
        expect({ steps, created: counts.created, disposed: counts.disposed }).toEqual({
          steps,
          created: 1,
          disposed: 1,
        })
      }
      expect({ longest: longest > 0, lateCalls }).toEqual({ longest: true, lateCalls: [] })
    })

  // Architecture contract (the LEAD's ruling): the core is reachable only through `use`, whose callback reaches the core
  // before its first await of anything else; no member holds the creation's result or the private acquire.
  test("#given the threads namespace source #then every core use goes through use() and each callback reaches the core before any other await", async () => {
    const source = await Bun.file(new URL("./threads.ts", import.meta.url)).text()
    expect(source.match(/\bacquire\b|\.core\b|\bready\b/g) ?? []).toEqual([])
    const callbacks = [...source.matchAll(/\buse\(\s*async \(core\) =>/g)].map((match) => {
      const rest = source.slice((match.index ?? 0) + match[0].length)
      return rest
        .slice(0, rest.indexOf("core."))
        .replace(/await\s*$/, "")
        .replace(/await settledExtension\(async \(\) =>\s*$/, "")
    })
    expect(callbacks.length).toBeGreaterThan(10)
    expect(callbacks.filter((prefix) => /\bawait\b|\.then\(/.test(prefix))).toEqual([])
  })

  test("#given the dispose matrix #then it covers 16 cells: every outcome before and during the load, every construction outcome during construction, and a ready core", () => {
    const cells = Object.entries(OUTCOMES).flatMap(([outcome, { stage }]) =>
      MOMENTS.filter((moment) => exists(stage, moment, outcome)),
    )
    expect(cells.length).toBe(16)
  })
})

// Security note (B) and review 6075851574 MEDIUM 3, one boundary: a loaded file whose core cannot be built answers every
// thread member typed, with the exception at the logger port alone; an operation of a built core that throws keeps P1b's
// own boundaries (the fixed store-extension text, the warm's own error).
const CONSTRUCTION_TEXT = "the core's constructor failed while opening /home/probe/.omo/agent/sessions"

const MEMBER_INPUTS: Readonly<Record<string, unknown>> = {
  "threads.extensions.register": { name: "probe", moduleUrl: "file:///probe/extension.js" },
  "threads.extensions.call": { name: "probe", op: "ping", args: {} },
  "threads.read": { thread: "t" },
  "threads.send": { thread: "t", message: "m" },
  "threads.locate": { thread: "t" },
  "threads.interrupt": { thread: "t" },
  "threads.setModel": { thread: "t", model: "m" },
  "threads.release": { thread: "t" },
}

describe("a thread core that cannot be built from a loaded file", () => {
  const throwingRuntime: ThreadsRuntime = {
    ...runtimeWith(() => ({ kind: "ok", threads: [] })),
    createThreadCore: (() => {
      throw new Error(CONSTRUCTION_TEXT)
    }) as unknown as ThreadsRuntime["createThreadCore"],
  }
  const members = Object.keys(namespace(() => Promise.resolve(throwingRuntime)).members)

  test("#given the namespace #then it serves the thirteen thread members this boundary covers", () => {
    expect(members).toHaveLength(13)
  })

  for (const member of members)
    test(`#given a core whose construction throws #when ${member} runs #then it answers internal_error and the exception reaches the port alone`, async () => {
      const seen: unknown[] = []
      const served = namespace(
        () => Promise.resolve(throwingRuntime),
        (error) => {
          seen.push(error)
          return false
        },
      )
      const answer = (await callMember(served, member)(MEMBER_INPUTS[member] ?? {})) as {
        kind: string
        error: { code: string; message: string }
      }
      expect({ kind: answer.kind, code: answer.error.code }).toEqual({ kind: "error", code: "internal_error" })
      expect(answer.error.message.endsWith(UNEXPECTED_LOG_UNWRITTEN)).toBe(true)
      expect(JSON.stringify(answer)).not.toContain("constructor failed")
      expect(seen.map(String)).toEqual([`Error: ${CONSTRUCTION_TEXT}`])
    })

  test("#given a core whose construction failed once #when the next call runs #then it builds the core again", async () => {
    let builds = 0
    const served = namespace(() =>
      Promise.resolve({
        ...throwingRuntime,
        createThreadCore: (() => {
          builds += 1
          if (builds === 1) throw new Error(CONSTRUCTION_TEXT)
          return fullCore()
        }) as unknown as ThreadsRuntime["createThreadCore"],
      }),
    )
    await list(served)
    const second = (await list(served)) as { kind: string }
    expect({ builds, kind: second.kind }).toEqual({ builds: 2, kind: "ok" })
  })
})

// Design lane ruling on the security note (A): a file on disk is a system boundary. A thread file from another build (its
// stamp differs from the root's) or one without the three exports the root takes answers a typed refusal on every member,
// never a TypeError; the port gets a fixed diagnostic, never the file's contents; nothing of it is kept.
// Each case with the one fixed line the logger port gets (security review 6078171033 S1-S3): the line names the check that
// failed, so a check that stops working shows as another line, never as the same refusal for a different reason.
const MISMATCHES: Readonly<Record<string, readonly [Readonly<Record<string, unknown>>, string]>> = {
  "a stamp from another build": [{ RUNTIME_STAMP: "another-build" }, "its build stamp is not this root's"],
  "no stamp": [{ RUNTIME_STAMP: undefined }, "its build stamp is not this root's"],
  "no createThreadCore": [{ createThreadCore: undefined }, "it has no createThreadCore function"],
  "no fail": [{ fail: undefined }, "it has no fail function"],
  "no threadToolParamSchemas": [{ threadToolParamSchemas: undefined }, "it has no threadToolParamSchemas object"],
  "a createThreadCore that is not a function": [{ createThreadCore: {} }, "it has no createThreadCore function"],
  "threadToolParamSchemas that are not an object": [
    { threadToolParamSchemas: "schemas" },
    "it has no threadToolParamSchemas object",
  ],
  "threadToolParamSchemas that are null": [{ threadToolParamSchemas: null }, "it has no threadToolParamSchemas object"],
  "threadToolParamSchemas that are an array": [
    { threadToolParamSchemas: [] },
    "it has no threadToolParamSchemas object",
  ],
  "no thread_create schema": [{ threadToolParamSchemas: {} }, "its thread_create schema has no properties"],
  "a thread_create schema without properties": [
    { threadToolParamSchemas: { thread_create: {} } },
    "its thread_create schema has no properties",
  ],
  "a fail that answers nothing": [{ fail: () => undefined }, "its fail does not answer a failure"],
  "a fail whose failure has no code or message": [
    { fail: () => ({ kind: "error", error: {} }) },
    "its fail does not answer a failure",
  ],
  "a fail that throws": [
    {
      fail: () => {
        throw new Error("the fail of another build")
      },
    },
    "reading its exports threw",
  ],
  "a core without the calls the root makes": [{ createThreadCore: () => ({}) }, "its core has no list function"],
  "an export whose getter throws": [
    Object.defineProperty({}, "createThreadCore", {
      enumerable: true,
      get() {
        throw new Error("the getter of another build")
      },
    }),
    "reading its exports threw",
  ],
}

describe("a thread runtime file that loads but does not match the root", () => {
  const members = Object.keys(namespace(() => Promise.resolve(runtimeWith(() => undefined))).members)

  for (const [mismatch, [change, line]] of Object.entries(MISMATCHES))
    for (const member of members)
      test(`#given ${mismatch} #when ${member} runs #then it answers runtime_file_mismatch and the port gets a fixed diagnostic`, async () => {
        const seen: unknown[] = []
        // Copied by descriptor, so a getter in a case runs only when the root reads it.
        const loaded = Object.defineProperties(
          { ...runtimeWith(() => ({ kind: "ok", threads: [] })) },
          Object.getOwnPropertyDescriptors(change),
        ) as unknown as ThreadsRuntime
        const served = namespace(
          () => Promise.resolve(loaded),
          (error) => {
            seen.push(error)
            return false
          },
        )
        const answer = (await callMember(served, member)(MEMBER_INPUTS[member] ?? {})) as {
          kind: string
          error: { code: string; message: string; details: unknown }
        }
        expect({ kind: answer.kind, code: answer.error.code, details: answer.error.details }).toEqual({
          kind: "error",
          code: "internal_error",
          details: { reason: RUNTIME_FILE_MISMATCH, file: "threads" },
        })
        expect(answer.error.message.endsWith(UNEXPECTED_LOG_UNWRITTEN)).toBe(true)
        expect(JSON.stringify(answer)).not.toContain("another-build")
        expect(seen.map(String)).toEqual([`Error: The thread runtime file does not match this root: ${line}.`])
      })

  test("#given a mismatched file #when the next call finds a matching one #then it reaches the thread core", async () => {
    let loads = 0
    const served = namespace(() => {
      loads += 1
      const runtime = runtimeWith(() => ({ kind: "ok", threads: [] }))
      return Promise.resolve(loads === 1 ? { ...runtime, RUNTIME_STAMP: "another-build" } : runtime)
    })
    const first = (await list(served)) as { error: { details: unknown } }
    const second = (await list(served)) as { kind: string }
    expect({ first: first.error.details, second: second.kind, loads }).toEqual({
      first: { reason: RUNTIME_FILE_MISMATCH, file: "threads" },
      second: "ok",
      loads: 2,
    })
  })
})

// Security review 6077124491 Q1: the port's fixed diagnostic names the check that failed, so a null schemas export is
// caught by its own clause, not by an exception a later dereference would throw.
test("#given threadToolParamSchemas that are null #when a thread call runs #then the port is told that export is missing", async () => {
  const seen: unknown[] = []
  const loaded = { ...runtimeWith(() => undefined), threadToolParamSchemas: null } as unknown as ThreadsRuntime
  await list(
    namespace(
      () => Promise.resolve(loaded),
      (error) => {
        seen.push(error)
        return false
      },
    ),
  )
  expect(seen.map(String)).toEqual([
    "Error: The thread runtime file does not match this root: it has no threadToolParamSchemas object.",
  ])
})

// Architecture contract (the design lane's ruling on review 6077124491): the core is checked against one table of the
// members the root calls, and every core member this file calls is in that table, so a new call cannot skip the check.
test("#given the threads namespace source #then every core member it calls is in the table the core is checked against", async () => {
  const source = await Bun.file(new URL("./threads.ts", import.meta.url)).text()
  const called = new Set(
    [...source.matchAll(/\b(?:core|ready|made\.core|ready\.core)\.(\w+)\(/g)].map((match) => match[1] as string),
  )
  // The extension calls are the store port's (a caller's port, not the file), answered by settledExtension's boundary.
  expect([...called].filter((name) => !(CORE_CALLS as readonly string[]).includes(name))).toEqual([])
  expect(called.size).toBeGreaterThan(5)
})

describe("an operation of a built core that throws keeps P1b's boundaries", () => {
  const operationText = "the store's file at /home/probe/.omo/agent/store.db is locked"
  const failingCore: ThreadsRuntime = {
    ...runtimeWith(() => ({ kind: "ok", threads: [] })),
    createThreadCore: (() =>
      fullCore({
        extensions: {
          register: async () => {
            throw new Error(operationText)
          },
          call: async () => {
            throw new Error(operationText)
          },
        },
        warm: async () => {
          throw new Error("the daemon socket refused the warm")
        },
      })) as unknown as ThreadsRuntime["createThreadCore"],
  }
  const served = () => namespace(() => Promise.resolve(failingCore))

  for (const member of ["threads.extensions.register", "threads.extensions.call"])
    test(`#given an extension operation that throws #when ${member} runs #then it answers the fixed store-extension failure`, async () => {
      const answer = await callMember(served(), member)(MEMBER_INPUTS[member])
      expect(answer).toEqual({
        kind: "error",
        error: {
          code: "internal_error",
          message: "The store extension operation failed unexpectedly.",
          next_action: "Call it again; if it fails again, run omo doctor.",
        },
      })
    })

  test("#given a warm that throws #when daemon.warm runs #then it answers the warm's own error as omo daemon run prints it", async () => {
    const answer = await (served().members["daemon.warm"] as (input?: unknown) => Promise<unknown>)({})
    expect(answer).toEqual({
      kind: "error",
      error: {
        code: "internal_error",
        message: "the daemon socket refused the warm",
        next_action: "Run omo daemon run again.",
      },
    })
  })
})
