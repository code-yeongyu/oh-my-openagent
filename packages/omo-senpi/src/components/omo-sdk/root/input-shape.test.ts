import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { runInNewContext } from "node:vm"

import { assembleOmoSdk } from "../assembly"
import { ROOT_CALL_ANSWERS } from "../contract/call-answers"
import { invalidInput } from "./assemble"
import type { RootCallKey } from "../contract"

// Design lane ruling on the boundary order (P1b): a call's input is checked for its shape before any member reads it, so
// a non-object input answers a typed refusal and never throws, for every root call. The ports record any use.
const used: string[] = []
const record =
  (name: string) =>
  (...args: unknown[]): never => {
    used.push(name)
    throw new Error(`port ${name} used with ${args.length} argument(s)`)
  }

const root = () =>
  assembleOmoSdk(
    {
      env: { OMO_SERVICE_API_URL: "https://accounts.example.test" },
      cwd: tmpdir(),
      agentDir: tmpdir(),
      principal: { kind: "script", uid: 501 },
      ports: {
        desktopLaunch: record("desktopLaunch"),
        session: { accessToken: record("accessToken"), request: record("request") },
        deviceServiceStatus: record("deviceServiceStatus"),
        signInProcess: record("signInProcess"),
      } as never,
    },
    {},
  )

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

const codeOf = async (answer: unknown): Promise<unknown> => {
  const settled = await answer
  if (typeof settled === "object" && settled !== null && Symbol.asyncIterator in settled) {
    for await (const event of settled as AsyncIterable<{ kind?: string; failure?: { code?: string } }>)
      if (event.kind === "end") return event.failure?.code
    return undefined
  }
  return (settled as { error?: { code?: string } }).error?.code
}

const callOf = (sdk: ReturnType<typeof root>, key: RootCallKey) =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], sdk) as (
    input: unknown,
  ) => unknown

describe("the root's input shape check", () => {
  const keys = Object.keys(ROOT_CALL_ANSWERS) as RootCallKey[]
  for (const [label, input] of [
    ["a string", "x"],
    ["a number", 42],
    ["null", null],
    ["an array", [{}]],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["a boxed string", Object("x")],
    ["a class instance", new (class Probe {})()],
    // Design lane L3: an object from another realm has that realm's Object.prototype, so the strict reading refuses it.
    ["an object built in another vm context", runInNewContext("({})")],
  ] as const)
    test(`#given ${label} as the input #when every root call is called with it #then each answers a typed refusal and no port is used`, async () => {
      used.length = 0
      const sdk = root()
      const answers: [RootCallKey, unknown][] = []
      for (const key of keys) answers.push([key, await codeOf(callOf(sdk, key)(input))])
      // A call the principal's line refuses answers that refusal first (design 4.4), whatever its input.
      const other = answers.filter(([, code]) => code !== "invalid_arguments")
      const lineRefusals = await Promise.all(
        other.map(async ([key]): Promise<[RootCallKey, unknown]> => [key, await codeOf(callOf(sdk, key)({}))]),
      )
      expect(other).toEqual(lineRefusals)
      expect(other.every(([, code]) => typeof code === "string" && code !== "not_implemented")).toBe(true)
      expect(used).toEqual([])
      await sdk.dispose()
    })

  // An accepted call reaches its member, whose first port use throws here; the outcome compared is that answer.
  const settle = async (sdk: ReturnType<typeof root>, key: RootCallKey, input: unknown) => {
    used.length = 0
    try {
      return { failure: await failureOf(callOf(sdk, key)(input)), ports: [...used] }
    } catch (error) {
      return { threw: (error as Error).message, ports: [...used] }
    }
  }

  // Review 6075306724 L2: a null-prototype object is a plain input, answered exactly as the empty literal.
  test("#given a null-prototype empty object #when every root call is called with it #then each answers as for {}", async () => {
    const sdk = root()
    for (const key of keys)
      expect([key, await settle(sdk, key, Object.create(null))]).toEqual([key, await settle(sdk, key, {})])
    await sdk.dispose()
  })

  // Review 6075306724 L1, the class: every read the boundary makes of the caller's input (prototype, array check, key
  // listing, member reads) runs the caller's code. A throw there answers the fixed invalid_arguments text, never the
  // thrown text; a trap the boundary never runs leaves the input answered as the empty literal.
  const SECRET = "caller-thrown-text"
  const throwingIn = (trap: keyof ProxyHandler<object>): object =>
    new Proxy(
      {},
      {
        [trap]: () => {
          throw new Error(SECRET)
        },
      },
    )
  const throwingGetters = (names: readonly string[]): object =>
    Object.defineProperties(
      {},
      Object.fromEntries(
        names.map((name) => [
          name,
          {
            enumerable: true,
            get() {
              throw new Error(SECRET)
            },
          },
        ]),
      ),
    )
  const TRAPS = [
    "getPrototypeOf",
    "setPrototypeOf",
    "isExtensible",
    "preventExtensions",
    "getOwnPropertyDescriptor",
    "defineProperty",
    "has",
    "get",
    "set",
    "deleteProperty",
    "ownKeys",
  ] as const satisfies readonly (keyof ProxyHandler<object>)[]

  const expectRefusedOrAsEmpty = async (sdk: ReturnType<typeof root>, key: RootCallKey, input: unknown) => {
    const outcome = await settle(sdk, key, input)
    expect([key, JSON.stringify(outcome).includes(SECRET)]).toEqual([key, false])
    if (outcome.failure?.code === "invalid_arguments")
      expect([key, outcome.failure.message, outcome.ports]).toEqual([key, invalidInput(key).message, []])
    else expect([key, outcome]).toEqual([key, await settle(sdk, key, {})])
    return outcome.failure?.code === "invalid_arguments"
  }

  for (const trap of TRAPS)
    test(`#given a proxy whose ${trap} trap throws #when every root call is called with it #then each answers the fixed refusal or as for {}`, async () => {
      const sdk = root()
      for (const key of keys) await expectRefusedOrAsEmpty(sdk, key, throwingIn(trap))
      await sdk.dispose()
    })

  test("#given an object whose own getters throw, one per field the call's schema names #when every root call is called with it #then each answers the fixed refusal", async () => {
    const { ROOT_CALLS } = await import("../contract/calls")
    const sdk = root()
    for (const key of keys) {
      const named = Object.keys((ROOT_CALLS[key].input as { readonly properties?: object }).properties ?? {})
      const refused = await expectRefusedOrAsEmpty(sdk, key, throwingGetters(named.length === 0 ? ["unnamed"] : named))
      // A call whose schema names a field reads it, so the throw is reached and refused, unless its line refuses first.
      if (named.length > 0 && !refused)
        expect([key, (await settle(sdk, key, {})).failure?.code]).not.toEqual([key, undefined])
    }
    await sdk.dispose()
  })
})
