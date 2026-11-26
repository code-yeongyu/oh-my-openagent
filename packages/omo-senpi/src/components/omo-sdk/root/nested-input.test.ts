import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../assembly"
import { ROOT_CALL_ANSWERS } from "../contract/call-answers"
import type { RootCallKey } from "../contract"
import { admitted, inputShape, invalidInput } from "./assemble"

// Security read of b01f3fbdd4, N1, and the design lane's ruling: the boundary copies plain objects and arrays all the way
// down, each field read once, and below the top level a value where the schema asks for an object or array must be plain
// or an array; a non-plain value is kept only where the schema accepts any value or names nothing. Generated over every
// input field of every root call whose schema is an object or array.
const used: string[] = []
const record =
  (name: string) =>
  (...args: unknown[]): never => {
    used.push(name)
    throw new Error(`port ${name} used with ${args.length} argument(s)`)
  }
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-sdk-nested-"))
  dirs.push(dir)
  return assembleOmoSdk(
    {
      env: { HOME: dir, OMO_SERVICE_API_URL: "https://accounts.example.test" },
      cwd: dir,
      agentDir: dir,
      principal: { kind: "script", uid: 501 },
      ports: {
        desktopLaunch: () => false,
        session: { accessToken: record("accessToken"), request: record("request") },
        deviceServiceStatus: record("deviceServiceStatus"),
        signInProcess: record("signInProcess"),
        credentialStore: { read: record("credentialStore.read") },
      } as never,
    },
    {},
  )
}
const callOf = (sdk: ReturnType<typeof root>, key: RootCallKey) =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], sdk) as (
    input: unknown,
  ) => unknown
const failureOf = async (answer: unknown): Promise<{ code?: string; message?: string } | undefined> => {
  const settled = await answer
  if (typeof settled === "object" && settled !== null && Symbol.asyncIterator in settled) {
    for await (const event of settled as AsyncIterable<{
      kind?: string
      failure?: { code?: string; message?: string }
    }>)
      if (event.kind === "end") return event.failure && { code: event.failure.code, message: event.failure.message }
    return undefined
  }
  const error = (settled as { error?: { code?: string; message?: string } }).error
  return error && { code: error.code, message: error.message }
}

type Schema = { readonly type?: string; readonly anyOf?: readonly Schema[]; readonly oneOf?: readonly Schema[] }
const structured = (schema: Schema): "object" | "array" | undefined => {
  if (schema.type === "object" || schema.type === "array") return schema.type
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    const found = structured(branch)
    if (found !== undefined) return found
  }
  return undefined
}

// The principal's line and the call's availability are answered before the input is read.
const BEFORE_INPUT = ["no_matrix_cell", "caller_context_missing", "sender_not_allowed"]

class Probe {
  readonly field = "x"
}

const cycle = (): Record<string, unknown> => {
  const value: Record<string, unknown> = {}
  value["self"] = value
  return value
}

describe("nested input at the root's boundary", async () => {
  const { ROOT_CALLS } = await import("../contract/calls")
  const fields: { key: RootCallKey; name: string; kind: "object" | "array" }[] = []
  for (const key of Object.keys(ROOT_CALL_ANSWERS) as RootCallKey[])
    for (const [name, schema] of Object.entries(
      (ROOT_CALLS[key].input as { readonly properties?: Record<string, Schema> }).properties ?? {},
    )) {
      const kind = structured(schema)
      if (kind !== undefined) fields.push({ key, name, kind })
    }
  const nest = (kind: "object" | "array", inner: unknown) => (kind === "array" ? [inner] : inner)
  const readsBeforeInput = async (sdk: ReturnType<typeof root>, key: RootCallKey) =>
    BEFORE_INPUT.includes((await failureOf(callOf(sdk, key)({})))?.code ?? "")

  test("#given the call table #then 66 input fields are objects or arrays", () => {
    expect(fields.length).toBe(66)
  })

  test("#given a nested counting getter in each object or array field #when the call runs #then the field is read once", async () => {
    const sdk = root()
    const reads: [string, number][] = []
    for (const { key, name, kind } of fields) {
      let count = 0
      const inner = Object.defineProperty({}, "probe", {
        enumerable: true,
        get() {
          count += 1
          return "x"
        },
      })
      await failureOf(callOf(sdk, key)({ [name]: nest(kind, inner) }))
      reads.push([`${key}.${name}`, (await readsBeforeInput(sdk, key)) ? 1 : count])
    }
    expect(reads.filter(([, count]) => count !== 1)).toEqual([])
    await sdk.dispose()
  })

  for (const [label, make, belowAny] of [
    [
      "a nested getter that throws",
      () =>
        Object.defineProperty({}, "probe", {
          enumerable: true,
          get() {
            throw new Error("caller-thrown-text")
          },
        }),
      true,
    ],
    ["a nested class instance", () => new Probe(), true],
    ["a nested proxy over a class instance", () => new Proxy(new Probe(), {}), true],
    // Below a field whose members accept any value (daemon.warm's context.*) nothing is copied, so a cycle or a depth
    // there is the caller's own value, passed as it is.
    ["a nested cycle", cycle, false],
    [
      "a nesting 40 deep",
      () => Array.from({ length: 40 }).reduce<Record<string, unknown>>((inner) => ({ inner }), {}),
      false,
    ],
  ] as const)
    test(`#given ${label} in each object or array field #when the call runs #then it answers the fixed invalid_arguments and uses no port`, async () => {
      const sdk = root()
      used.length = 0
      const wrong: [string, unknown][] = []
      for (const { key, name, kind } of fields) {
        if (await readsBeforeInput(sdk, key)) continue
        const anyBelow = [...(await inputShape(key)).anyValue].some((path) => path.startsWith(`${name}.`))
        if (anyBelow && !belowAny) continue
        const failure = await failureOf(callOf(sdk, key)({ [name]: nest(kind, make()) }))
        if (failure?.code !== "invalid_arguments" || failure.message !== invalidInput(key).message)
          wrong.push([`${key}.${name}`, failure])
      }
      expect(wrong).toEqual([])
      expect(used).toEqual([])
      await sdk.dispose()
    })

  test("#given a valid threads.create whose nested worktree and skills throw on a second read #when it runs #then each is read once and nothing the caller throws later reaches the answer", async () => {
    // given: the member runs (a valid input), so a read after the root's check would show
    const sdk = root()
    let branchReads = 0
    let skillReads = 0
    const worktree = Object.defineProperty({}, "branch", {
      enumerable: true,
      get() {
        branchReads += 1
        if (branchReads > 1) throw new Error("caller-thrown-text")
        return "feature-x"
      },
    })
    const skills = new Proxy(["alpha"], {
      get(target, property, receiver) {
        if (property === "0") {
          skillReads += 1
          if (skillReads > 1) throw new Error("caller-thrown-text")
        }
        return Reflect.get(target, property, receiver)
      },
    })

    // when
    const failure = await failureOf(sdk.threads.create({ name: "n", prompt: "hi", worktree, skills } as never))

    // then
    expect({ branchReads, skillReads }).toEqual({ branchReads: 1, skillReads: 1 })
    expect(JSON.stringify(failure ?? null)).not.toContain("caller-thrown-text")
    await sdk.dispose()
  })

  // LEAD ruling (1), 20:36Z: free data under the built members' any-value fields is copied too. Each case puts a counting
  // object at the any-value field; the boundary reads it once, and what the member receives is the copy.
  const counting = () => {
    const reads = { count: 0 }
    const value = Object.defineProperty({}, "probe", {
      enumerable: true,
      get() {
        reads.count += 1
        return reads.count === 1 ? "first" : "changed"
      },
    })
    return { reads, value }
  }
  const FREE_DATA: readonly [
    RootCallKey,
    string,
    (value: unknown) => Record<string, unknown>,
    (own: Record<string, unknown>) => unknown,
  ][] = [
    [
      "threads.extensions.call",
      "args",
      (value) => ({ name: "probe.ext", op: "ping", args: { nested: value } }),
      (own) => (own["args"] as Record<string, unknown>)["nested"],
    ],
    [
      "threads.extensions.register",
      "sessionCallable[].parameters.*",
      (value) => ({
        name: "probe.ext",
        migrations: [],
        moduleUrl: "file:///probe/ext.js",
        sessionCallable: [{ op: "ping", parameters: { field: value }, toolName: "probe_tool", description: "d" }],
      }),
      (own) =>
        ((own["sessionCallable"] as Record<string, unknown>[])[0]?.["parameters"] as Record<string, unknown>)["field"],
    ],
  ]

  for (const [key, path, inputWith, at] of FREE_DATA)
    test(`#given a counting object under ${key}'s any-value field ${path} #when the boundary admits it #then it is read once and the member receives a copy holding the first value`, async () => {
      // given
      expect((await inputShape(key)).anyValue.has(path)).toBe(true)
      const { reads, value } = counting()

      // when
      const own = await admitted(key, inputWith(value))

      // then
      expect(own).toBeDefined()
      const received = at(own as Record<string, unknown>)
      expect(received).not.toBe(value)
      expect(received).toEqual({ probe: "first" })
      expect(reads.count).toBe(1)
    })

  test("#given an extension call whose nested args change on a second read #when the root runs the call #then the caller's object is read once", async () => {
    const sdk = root()
    const { reads, value } = counting()
    await failureOf(sdk.threads.extensions.call({ name: "probe.ext", op: "ping", args: { nested: value } } as never))
    expect(reads.count).toBe(1)
    await sdk.dispose()
  })

  test("#given extension args holding a class instance, a Map, a Date and bytes #when the boundary admits them #then the member receives their structured clone, as the store makes it", async () => {
    class Point {
      constructor(readonly x: number) {}
    }
    const args = { point: new Point(1), map: new Map([["k", 1]]), at: new Date(0), bytes: new Uint8Array([1]) }
    const own = await admitted("threads.extensions.call", { name: "probe.ext", op: "ping", args })
    const received = own?.["args"] as Record<string, unknown>
    expect(received).toEqual(structuredClone(args))
    expect(received["map"]).not.toBe(args.map)
    expect(Object.getPrototypeOf(received["point"])).toBe(Object.prototype)
  })

  for (const [label, args] of [
    ["a function", { run: () => undefined }],
    ["a proxy", { inner: new Proxy({}, {}) }],
    [
      "a getter that throws",
      Object.defineProperty({}, "inner", {
        enumerable: true,
        get() {
          throw new Error("caller-thrown-text")
        },
      }),
    ],
  ] as const)
    test(`#given extension args holding ${label} #when the root runs the call #then it answers the fixed invalid_arguments with no caller text`, async () => {
      const sdk = root()
      const failure = await failureOf(sdk.threads.extensions.call({ name: "probe.ext", op: "ping", args } as never))
      expect(failure).toEqual({ code: "invalid_arguments", message: invalidInput("threads.extensions.call").message })
      await sdk.dispose()
    })

  test("#given attachment bytes under an any-value field #when the boundary admits them #then the member receives the same bytes object", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const own = await admitted("threads.send", {
      thread: "t",
      message: "m",
      attachments: [{ bytes, name: "a.bin" }],
    })
    expect((own?.["attachments"] as Record<string, unknown>[])[0]?.["bytes"]).toBe(bytes)
  })

  test("#given the call table #then the fields that accept any value are exactly the reviewed list", async () => {
    const found: string[] = []
    for (const key of Object.keys(ROOT_CALL_ANSWERS) as RootCallKey[])
      for (const path of (await inputShape(key)).anyValue) found.push(`${key}:${path}`)
    expect(found.toSorted()).toEqual(
      [
        "account.signIn:onOpenUrl",
        "account.signIn:onUserCode",
        "account.signIn:signal",
        "daemon.warm:context.*",
        "engine.schedule.run:signal",
        "sync.enable:confirm",
        "sync.enable:onCode",
        "sync.enable:signal",
        "sync.recover:confirm",
        "sync.recover:signal",
        "threads.create:prompt.attachments[].bytes",
        "threads.extensions.call:args",
        "threads.extensions.register:sessionCallable[].parameters.*",
        "threads.extensions.sessionCall:args",
        "threads.runToCompletion:signal",
        "threads.send:attachments[].bytes",
        "threads.sendAndFollow:attachments[].bytes",
        "toolkit.steer:proposals",
      ].toSorted(),
    )
  })
})
