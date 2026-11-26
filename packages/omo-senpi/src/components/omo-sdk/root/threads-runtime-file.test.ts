import { describe, expect, test } from "bun:test"

import { UNEXPECTED_LOG_UNWRITTEN, unexpectedLogNamed } from "../unexpected-port"
import { RUNTIME_STAMP } from "../runtime-stamp"
import { RUNTIME_FILE_MISMATCH, RUNTIME_FILE_UNAVAILABLE, type ThreadsRuntime, threadsNamespace } from "./threads"

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

function runtimeWith(list: () => unknown): ThreadsRuntime {
  return {
    RUNTIME_STAMP,
    createThreadCore: (() => ({ list })) as unknown as ThreadsRuntime["createThreadCore"],
    fail: (() => {
      throw new Error("fail is not reached in these cases")
    }) as ThreadsRuntime["fail"],
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
        return {
          list: async () => ({ kind: "ok", threads: [] }),
          dispose: async () => {
            counts.disposed += 1
          },
        }
      }) as unknown as ThreadsRuntime["createThreadCore"],
    }
    return { counts, runtime }
  }

  test("#given a first load held open #when dispose runs and the load then succeeds #then the core it built is disposed", async () => {
    const gate = held()
    const { counts, runtime } = countingRuntime()
    const served = namespace(gate.load)
    const call = list(served)
    await gate.loading
    const disposed = served.dispose?.()
    gate.release(runtime)
    await Promise.all([call, disposed])
    expect(counts).toEqual({ created: 1, disposed: 1 })
  })

  test("#given a first load held open #when dispose runs and the load then fails #then no core is built and the caller's store is released", async () => {
    const gate = held()
    let storeDisposed = 0
    const served = threadsNamespace({
      agentDir: "/agent-dir-never-read",
      cwd: "/cwd-never-read",
      uid: 501,
      user: "probe",
      env: {},
      principal: { kind: "script", uid: 501 },
      loadThreadsRuntime: gate.load,
      ports: {
        store: {
          dispose: async () => {
            storeDisposed += 1
          },
        } as unknown as NonNullable<Parameters<typeof threadsNamespace>[0]["ports"]>["store"],
      },
    })
    const call = list(served)
    await gate.loading
    const disposed = served.dispose?.()
    gate.reject(new Error(EXCEPTION_TEXT))
    const [answer] = await Promise.all([call, disposed])
    expect((answer as { error: { details: unknown } }).error.details).toEqual({
      reason: RUNTIME_FILE_UNAVAILABLE,
      file: "threads",
    })
    expect(storeDisposed).toBe(1)
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
          return { list: async () => ({ kind: "ok", threads: [] }) }
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
const MISMATCHES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "a stamp from another build": { RUNTIME_STAMP: "another-build" },
  "no stamp": { RUNTIME_STAMP: undefined },
  "no createThreadCore": { createThreadCore: undefined },
  "no fail": { fail: undefined },
  "no threadToolParamSchemas": { threadToolParamSchemas: undefined },
  "a createThreadCore that is not a function": { createThreadCore: {} },
  "threadToolParamSchemas that are not an object": { threadToolParamSchemas: "schemas" },
}

describe("a thread runtime file that loads but does not match the root", () => {
  const members = Object.keys(namespace(() => Promise.resolve(runtimeWith(() => undefined))).members)

  for (const [mismatch, change] of Object.entries(MISMATCHES))
    for (const member of members)
      test(`#given ${mismatch} #when ${member} runs #then it answers runtime_file_mismatch and the port gets a fixed diagnostic`, async () => {
        const seen: unknown[] = []
        const loaded = { ...runtimeWith(() => ({ kind: "ok", threads: [] })), ...change } as unknown as ThreadsRuntime
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
        expect(seen).toHaveLength(1)
        expect(JSON.stringify(String(seen[0]))).not.toContain("another-build")
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

describe("an operation of a built core that throws keeps P1b's boundaries", () => {
  const operationText = "the store's file at /home/probe/.omo/agent/store.db is locked"
  const failingCore: ThreadsRuntime = {
    ...runtimeWith(() => ({ kind: "ok", threads: [] })),
    createThreadCore: (() => ({
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
