import { describe, expect, test } from "bun:test"

import { UNEXPECTED_LOG_UNWRITTEN, unexpectedLogNamed } from "../unexpected-port"
import { RUNTIME_FILE_UNAVAILABLE, type ThreadsRuntime, threadsNamespace } from "./threads"

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
    createThreadCore: (() => ({ list })) as unknown as ThreadsRuntime["createThreadCore"],
    fail: (() => {
      throw new Error("fail is not reached in these cases")
    }) as ThreadsRuntime["fail"],
    threadToolParamSchemas: {
      thread_create: { properties: {} },
    } as unknown as ThreadsRuntime["threadToolParamSchemas"],
  }
}

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

  test("#given a load that failed #when the next thread call runs #then it loads again and reaches the thread core", async () => {
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
