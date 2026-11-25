import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import type { ThreadToolName } from "./contracts"
import { threadToolParamSchemas } from "./contracts"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// B8 (security ruling, carried by T1b #14951): an unexpected exception answers internal_error with fixed text on every
// thread surface; nothing of it reaches an answer or anything the call persists, and only `onUnexpected` sees it. Every
// canary below shares the TAG, so one scan finds any of them; the root's every-call walk is non-disclosure.test.ts.

const TAG = "cnry-b8"
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function throwShapes(): Record<string, () => unknown> {
  const inStack = new Error("boom")
  inStack.stack = `Error: boom\n    at ${TAG}-stack (/secret/${TAG}-path.ts:1:1)`
  const chained = new Error(`${TAG}-msg`, {
    cause: new Error(`${TAG}-cause-1`, { cause: new Error(`${TAG}-cause-2`) }),
  })
  const withProps = Object.assign(new Error("boom"), { token: `${TAG}-enumerable` })
  Object.defineProperty(withProps, "hidden", { value: `${TAG}-hidden`, enumerable: false })
  return {
    stack: () => inStack,
    "cause chain": () => chained,
    properties: () => withProps,
    string: () => `${TAG}-string`,
    object: () => ({ message: `${TAG}-object`, code: "internal_error" }),
  }
}

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function leaks(agentDir: string, answers: readonly unknown[]): string[] {
  const written = filesUnder(agentDir).filter((path) => readFileSync(path, "latin1").includes(TAG))
  const said = answers.map((answer) => JSON.stringify(answer)).filter((text) => text?.includes(TAG))
  return [...written, ...said]
}

function world(onUnexpected?: (error: unknown) => unknown) {
  const seen: unknown[] = []
  const s = surface(account().remote, {
    onUnexpected: (error: unknown) => {
      seen.push(error)
      return onUnexpected?.(error)
    },
  })
  return { s, sdk: s.sdk(), seen }
}

function faultEverything(s: ReturnType<typeof world>["s"], raise: () => unknown) {
  for (const [name, value] of Object.entries(s.host))
    if (typeof value === "function")
      Object.assign(s.host, {
        [name]: async () => {
          throw raise()
        },
      })
}

describe("B8: an unexpected exception on every thread surface", () => {
  for (const [shape, raise] of Object.entries(throwShapes()))
    test(`#given a host that throws ${shape} #when the tool and the SDK list, close and run a keyed create and its retry #then internal_error with fixed text, nothing in any answer or persisted file, and the value reaches onUnexpected`, async () => {
      const { s, sdk, seen } = world()
      faultEverything(s, raise)
      const create = { name: "b8-create", idempotency_key: `k-${shape}` }
      const answers = [
        await s.run("thread_list", {}),
        await s.run("thread_close", { thread: "dur-local" }),
        await s.run("thread_create", create),
        await s.run("thread_create", create),
        await sdk.list({}),
        await sdk.close({ thread: "dur-local" }),
        await sdk.create(create),
        await sdk.create(create),
      ]
      expect(leaks(s.agentDir, answers)).toEqual([])
      for (const answer of answers.filter((each) => (each as { kind: string }).kind === "error"))
        expect((answer as { error: { code: string } }).error.code).toMatch(/^(internal_error|idempotency_uncertain)$/)
      expect(seen.length).toBeGreaterThan(0)
    })

  test("#given a host that rejects with a rejected promise's object #when the SDK lists #then the fixed failure", async () => {
    const { s, sdk } = world()
    Object.assign(s.host, { listView: () => Promise.reject({ secret: `${TAG}-rejected` }) })
    const answer = await sdk.list({})
    expect(answer).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(leaks(s.agentDir, [answer])).toEqual([])
  })

  test("#given a host whose every method throws #when every thread tool runs #then each answers a code, never the thrown text, and nothing persisted carries it", async () => {
    const { s } = world()
    faultEverything(s, () => new Error(`${TAG}-every`))
    const minimal: Record<ThreadToolName, Record<string, unknown>> = {
      thread_list: {},
      thread_read: { thread: "dur-local" },
      thread_send: { thread: "dur-local", message: "hi" },
      thread_interrupt: { thread: "dur-local" },
      thread_close: { thread: "dur-local" },
      thread_rename: { thread: "dur-local", name: "renamed" },
      thread_set_model: { thread: "dur-local", model: "m" },
      thread_set_reasoning: { thread: "dur-local", level: "high" },
      thread_archive: { thread: "dur-local" },
      thread_handoff: { thread: "dur-local", message: "hi" },
      thread_create: { name: "every" },
    }
    expect(Object.keys(minimal).sort()).toEqual(Object.keys(threadToolParamSchemas).sort())
    const answers = []
    for (const [name, args] of Object.entries(minimal)) answers.push(await s.run(name as ThreadToolName, args))
    expect(leaks(s.agentDir, answers)).toEqual([])
  })

  test("#given a store whose receipt admission throws #when a keyed close runs through the tool and the SDK #then internal_error with no exception text", async () => {
    const { s, sdk, seen } = world()
    Object.assign(s.store, {
      toolReceiptBegin: async () => {
        throw new Error(`${TAG}-store`)
      },
    })
    const args = { thread: "dur-local", idempotency_key: "k-b8-store" }
    const answers = [await s.run("thread_close", args), await sdk.close(args)]
    for (const answer of answers) expect(answer).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(leaks(s.agentDir, answers)).toEqual([])
    expect(seen.length).toBe(2)
  })
})

describe("B8: the logger port is isolated from the outcome", () => {
  const ports: Record<string, () => unknown> = {
    throws: () => {
      throw new Error("logger down")
    },
    hangs: () => new Promise(() => undefined),
    rejects: () => Promise.reject(new Error("logger down")),
  }
  for (const [how, port] of Object.entries(ports))
    test(`#given a logger that ${how} #when a keyed create fails and is retried #then the answers and the persisted receipt are the same as with a quiet logger`, async () => {
      const outcome = async (logger: (() => unknown) | undefined) => {
        const { s, sdk } = world(logger)
        faultEverything(s, () => new Error(`${TAG}-logged`))
        const create = { name: "logged", idempotency_key: "k-logger" }
        const answers = [await s.run("thread_create", create), await sdk.create(create), await sdk.create(create)]
        return { answers: JSON.parse(JSON.stringify(answers)) as unknown, leaks: leaks(s.agentDir, answers) }
      }
      const quiet = await outcome(undefined)
      const loud = await outcome(port)
      expect(loud).toEqual(quiet)
      expect(loud.leaks).toEqual([])
    })
})
