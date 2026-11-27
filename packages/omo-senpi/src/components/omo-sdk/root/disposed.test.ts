import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../assembly"
import { ROOT_CALL_ANSWERS } from "../contract/call-answers"
import type { RootCallKey } from "../contract"
import { ROOT_DISPOSED } from "./assemble"
import { threadsNamespace } from "./threads"

// Design ruling on the disposed root (P1b): after dispose() every call is refused at the root's boundary with one answer,
// before the principal's line, the input, any member and any port. close() keeps the shipped behavior: the account and
// devices calls answer the shipped closed answer and no call is refused as disposed (also pinned in omo-sdk.test.ts).
// The exported refusal (P1c imports it) is exactly the ruled shape.
const RULED_DISPOSED = {
  code: "internal_error",
  message: "This omo SDK root was disposed; create a new root.",
  next_action: "Create a new omo SDK root and call it again.",
  details: { reason: "root_disposed" },
} as const
const SHIPPED_CLOSED = {
  code: "internal_error",
  message: "this SDK instance is closed",
  next_action: "create a new one with createOmoSdk",
}
const SHIPPED_CLOSED_KEYS: readonly RootCallKey[] = [
  "account.whoami",
  "account.signIn",
  "devices.list",
  "devices.rename",
]

const used: string[] = []
const record =
  (name: string) =>
  async (..._args: unknown[]): Promise<never> => {
    used.push(name)
    throw new Error(`port ${name} used`)
  }

// Each root works in its own directory: after close() the thread calls still run and open their store there.
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-sdk-disposed-"))
  dirs.push(dir)
  return dir
}

const root = (deviceServiceStatus: unknown = record("deviceServiceStatus"), dir = scratch()) =>
  assembleOmoSdk(
    {
      env: { HOME: dir, OMO_SERVICE_API_URL: "https://accounts.example.test" },
      cwd: dir,
      agentDir: dir,
      principal: { kind: "script", uid: 501 },
      ports: {
        desktopLaunch: record("desktopLaunch"),
        session: { accessToken: record("accessToken"), request: record("request") },
        deviceServiceStatus,
        signInProcess: record("signInProcess"),
        credentialStore: { read: record("credentialStore.read") },
      } as never,
    },
    {},
  )

const callOf = (sdk: ReturnType<typeof root>, key: RootCallKey) =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], sdk) as (
    input: unknown,
  ) => unknown

const errorOf = async (answer: unknown): Promise<unknown> => {
  const settled = await answer
  if (typeof settled === "object" && settled !== null && Symbol.asyncIterator in settled) {
    for await (const event of settled as AsyncIterable<{ kind?: string; failure?: unknown }>)
      if (event.kind === "end") return event.failure
    return undefined
  }
  return (settled as { error?: unknown }).error
}

describe("a disposed or closed root", () => {
  test("#given the exported disposed refusal #then it is the ruled answer", () => {
    expect(ROOT_DISPOSED).toEqual(RULED_DISPOSED)
  })

  const keys = Object.keys(ROOT_CALL_ANSWERS) as RootCallKey[]
  // The shipped calls get a valid input, so their member (not the input check) answers after close().
  const inputFor = async (key: RootCallKey): Promise<Record<string, unknown>> => {
    // account.signIn keeps its shipped convention: an options object without `method` is the shipped call.
    if (key === "account.signIn") return {}
    const { ROOT_CALLS } = await import("../contract/calls")
    const schema = ROOT_CALLS[key].input as {
      readonly required?: readonly string[]
      readonly properties?: Readonly<Record<string, { readonly type?: string }>>
    }
    return Object.fromEntries(
      (schema.required ?? []).map((field) => [field, schema.properties?.[field]?.type === "boolean" ? false : "probe"]),
    )
  }

  test("#given a root after dispose() #when every root call is called #then each answers the one disposed refusal and no port is used", async () => {
    // given
    const sdk = root()
    await sdk.dispose()
    used.length = 0

    // when
    const answers: [RootCallKey, unknown][] = []
    for (const key of keys) answers.push([key, await errorOf(callOf(sdk, key)(await inputFor(key)))])

    // then
    expect(answers).toEqual(keys.map((key) => [key, ROOT_DISPOSED]))
    expect(used).toEqual([])
  })

  test("#given a root after close() #when every root call is called #then the account and devices calls answer the shipped closed answer and none is refused as disposed", async () => {
    // given
    const sdk = root(async () => "not_running")
    sdk.close()

    // when
    const answers: [RootCallKey, unknown][] = []
    for (const key of keys) answers.push([key, await errorOf(callOf(sdk, key)(await inputFor(key)))])

    // then
    expect(Object.fromEntries(answers.filter(([key]) => SHIPPED_CLOSED_KEYS.includes(key)))).toEqual(
      Object.fromEntries(SHIPPED_CLOSED_KEYS.map((key) => [key, SHIPPED_CLOSED])),
    )
    expect(answers.filter(([, error]) => JSON.stringify(error ?? null).includes("root_disposed"))).toEqual([])
    await sdk.dispose()
  })

  test("#given a call inside its port #when the root is disposed and the port then answers #then the call answers what happened and the next call is refused", async () => {
    // given: the device service status read is held until the test releases it
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const inPort = new Promise<void>((resolve) => {
      entered = resolve
    })
    const sdk = root(async () => {
      used.push("deviceServiceStatus")
      entered?.()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return "not_running"
    })
    used.length = 0
    const inFlight = callOf(sdk, "deviceService.status")({})
    await inPort

    // when
    const disposed = sdk.dispose()
    release?.()

    // then
    expect(await inFlight).toEqual({ kind: "ok", value: expect.objectContaining({ state: "not_running" }) })
    await disposed
    expect(await errorOf(callOf(sdk, "deviceService.status")({}))).toEqual(ROOT_DISPOSED)
    expect(used).toEqual(["deviceServiceStatus"])
  })

  test("#given a disposed root #when dispose() runs again #then it resolves and the root stays refused", async () => {
    const sdk = root()
    await sdk.dispose()
    await sdk.dispose()
    expect(await errorOf(callOf(sdk, "config.status")({}))).toEqual(ROOT_DISPOSED)
  })

  // Code review 7202063494 (MEDIUM) and the security read's N2: dispose() while a call's input is still being checked.
  test("#given every root call started and dispose() in the same tick #when the calls settle #then each answers the disposed refusal unless its line refused it before the input, and no port is used after dispose() resolved", async () => {
    const beforeInput = new Set(["no_matrix_cell", "caller_context_missing", "sender_not_allowed"])
    const wrong: [RootCallKey, unknown][] = []
    for (const key of keys) {
      const sdk = root(async () => "not_running")
      const call = callOf(sdk, key)({})
      await sdk.dispose()
      used.length = 0
      const failure = (await errorOf(call)) as { code?: string } | undefined
      if (!beforeInput.has(failure?.code ?? "") && JSON.stringify(failure) !== JSON.stringify(ROOT_DISPOSED))
        wrong.push([key, failure])
      if (used.length > 0) wrong.push([key, used.splice(0)])
    }
    expect(wrong).toEqual([])
  })

  // Code delta review 7202772023: every member of the namespace, called after its dispose() began, answers the disposed
  // refusal, including those whose own catch handles a failure (extensions.register, extensions.call, daemon.warm).
  test("#given a disposed threads namespace #when each of its members is called #then each answers the disposed refusal or its own refusal decided before the core", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-sdk-disposed-ns-"))
    dirs.push(dir)
    const namespace = threadsNamespace({
      agentDir: dir,
      cwd: dir,
      uid: 501,
      user: "probe",
      env: { HOME: dir },
      principal: { kind: "script", uid: 501 },
    })
    await namespace.dispose?.()
    const valid: Record<string, unknown> = {
      "threads.extensions.register": { name: "probe.ext", migrations: [], moduleUrl: "file:///probe/ext.js" },
      "threads.extensions.call": { name: "probe.ext", op: "ping", args: {} },
    }
    const answers: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(namespace.members)) {
      const settled = (await (member as (input: unknown) => unknown)(valid[key] ?? {})) as {
        kind?: string
        error?: { code?: string; details?: { reason?: string } }
      }
      answers[key] = settled.error?.details?.reason ?? settled.error?.code ?? settled.kind
    }
    // A member refused before it reaches the core (a field it does not act on yet) keeps that answer.
    const other = Object.entries(answers).filter(
      ([, answer]) => answer !== "root_disposed" && answer !== "not_implemented",
    )
    expect(other).toEqual([])
    expect(answers["threads.extensions.register"]).toBe("root_disposed")
    expect(answers["threads.extensions.call"]).toBe("root_disposed")
    expect(answers["daemon.warm"]).toBe("root_disposed")
  })

  // Review of #14983 at 699c480398 (LOW 3): when the core's creation failed, dispose() awaited the rejected core and
  // never released the caller's ports. The caller's store and remote sessions are released whatever the core did.
  test("#given a threads namespace whose core failed to build #when it is disposed #then the caller's store and remote sessions are released", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-sdk-disposed-failed-core-"))
    dirs.push(dir)
    const released: string[] = []
    const store = {
      get now(): never {
        throw new Error("store unavailable")
      },
      dispose: async () => {
        released.push("store")
      },
    }
    const remote = { sessions: { close: async () => void released.push("remote") } }
    const namespace = threadsNamespace({
      agentDir: dir,
      cwd: dir,
      uid: 501,
      user: "probe",
      env: { HOME: dir },
      principal: { kind: "script", uid: 501 },
      ports: { store, remote } as never,
    })
    const listed = (namespace.members["threads.list"] as (input: unknown) => Promise<unknown>)({})
    await expect(listed).rejects.toThrow("store unavailable")
    await namespace.dispose?.()
    expect(released.toSorted()).toEqual(["remote", "store"])
  })
})
