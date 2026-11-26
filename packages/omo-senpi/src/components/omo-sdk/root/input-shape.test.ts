import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { assembleOmoSdk } from "../assembly"
import { ROOT_CALL_ANSWERS } from "../contract/call-answers"
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
    // Review 6075306724 L1: the shape check runs the caller's prototype trap; one that throws is still a typed refusal.
    [
      "a proxy whose prototype trap throws",
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("trap")
          },
        },
      ),
    ],
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

  // Review 6075306724 L2: a null-prototype object is a plain input, answered exactly as the empty literal.
  test("#given a null-prototype empty object #when every root call is called with it #then each answers as for {}", async () => {
    const sdk = root()
    // An accepted call reaches its member, whose first port use throws here; the outcome compared is that answer.
    const settle = async (input: unknown) => {
      used.length = 0
      try {
        return { code: await codeOf(callOf(sdk, key)(input)), ports: [...used] }
      } catch (error) {
        return { threw: (error as Error).message, ports: [...used] }
      }
    }
    let key: RootCallKey = keys[0] as RootCallKey
    for (key of keys) expect([key, await settle(Object.create(null))]).toEqual([key, await settle({})])
    await sdk.dispose()
  })

  // Review 6075306724 L1, the schema read: a call whose schema requires a field reads it; a getter that throws there
  // is a typed refusal, not a rejection, and no port is used.
  test("#given an input whose every read throws #when each root call with a required field is called #then each answers a typed refusal", async () => {
    const { ROOT_CALLS } = await import("../contract/calls")
    const requiring = keys.filter(
      (key) => ((ROOT_CALLS[key].input as { readonly required?: readonly string[] }).required ?? []).length > 0,
    )
    expect(requiring.length).toBeGreaterThan(0)
    const sdk = root()
    used.length = 0
    // Every field reads as present, so the schema reaches the read that throws.
    const throwing = new Proxy(
      {},
      {
        has: () => true,
        get() {
          throw new Error("getter")
        },
      },
    )
    for (const key of requiring) {
      const code = await codeOf(callOf(sdk, key)(throwing))
      expect([key, typeof code === "string" && code !== "not_implemented"]).toEqual([key, true])
    }
    expect(used).toEqual([])
    await sdk.dispose()
  })
})
