import { describe, expect, test } from "bun:test"

import { THREAD_ERROR_CODES, type ThreadToolFailure } from "../../thread/errors"
import { REMOTE_CODES } from "../../remote/codes"
import type { RemoteFailure } from "../../remote/types"
import { OMO_CODE_REGISTRY, type OmoFailure } from "../contract"
import { remoteFailure, remoteFailureOf } from "./remote-failures"
import { RESTORE_KEY } from "./restore"
import { threadFailure, threadToolFailureOf } from "./thread-failures"

// Design 4.4 and the design lane's ruling on review 6064490103: the conversions keep their bookkeeping in one reserved
// key no ordinary failure may carry, so every code crossed with details that hold the awkward keys on purpose converts
// there and back to a deeply equal failure, in both directions, for the thread core and the remote module.
const AWKWARD: readonly (Readonly<Record<string, unknown>> | undefined)[] = [
  undefined,
  {},
  { code: "not_found" },
  { code: "ENOENT", reason: "gone", kind: "error" },
  { details: { code: "orphaned" }, message: "inner" },
  { nested: { code: "timeout", list: [1, { kind: "ok" }] } },
  { present: null, absent: undefined },
]

const reversed = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).toReversed()) as T
const bothOrders = <T extends object>(values: readonly T[]): T[] => values.flatMap((value) => [value, reversed(value)])

const threadFailures = bothOrders(
  THREAD_ERROR_CODES.flatMap((code) =>
    AWKWARD.map((details): ThreadToolFailure => ({
      code,
      message: `m ${code}`,
      next_action: `n ${code}`,
      ...(details === undefined ? {} : { details }),
    })),
  ),
)

const remoteFailures = bothOrders(
  REMOTE_CODES.flatMap((code) =>
    AWKWARD.map((details): RemoteFailure => ({
      kind: "error",
      code,
      message: `m ${code}`,
      next_action: `n ${code}`,
      uncertain: false,
      command_id: "cmd",
      partial: null,
      ...(details === undefined ? {} : { details }),
    })),
  ),
)

const rootFailures = Object.keys(OMO_CODE_REGISTRY).flatMap((code) =>
  AWKWARD.map((details): OmoFailure => ({
    kind: "error",
    error: {
      code: code as OmoFailure["error"]["code"],
      message: `m ${code}`,
      next_action: `n ${code}`,
      ...(details === undefined ? {} : { details }),
    },
  })),
)

describe("lossless failure conversion, by property", () => {
  test("#given every thread code crossed with awkward details #when converted to the root and back #then each is deeply equal", () => {
    expect(
      threadFailures.filter(
        (failure) => JSON.stringify(threadToolFailureOf(threadFailure(failure))) !== JSON.stringify(failure),
      ),
    ).toEqual([])
  })

  test("#given every remote code crossed with awkward details #when converted to the root and back #then each is deeply equal", () => {
    expect(
      remoteFailures.filter(
        (failure) => JSON.stringify(remoteFailureOf(remoteFailure(failure))) !== JSON.stringify(failure),
      ),
    ).toEqual([])
  })

  test("#given every registered root failure a thread code names, crossed with awkward details #when converted to the thread shape and back #then each is deeply equal", () => {
    const threadNamed = rootFailures.filter((failure) =>
      (THREAD_ERROR_CODES as readonly string[]).includes(failure.error.code),
    )
    expect(threadNamed.length).toBeGreaterThan(0)
    expect(
      threadNamed.filter(
        (failure) => JSON.stringify(threadFailure(threadToolFailureOf(failure))) !== JSON.stringify(failure),
      ),
    ).toEqual([])
  })

  test("#given every registered root failure a remote code names, crossed with awkward details #when converted to the remote shape and back #then each is deeply equal", () => {
    const remoteNamed = rootFailures.filter((failure) =>
      (REMOTE_CODES as readonly string[]).includes(failure.error.code),
    )
    expect(remoteNamed.length).toBeGreaterThan(0)
    expect(
      remoteNamed.filter(
        (failure) => JSON.stringify(remoteFailure(remoteFailureOf(failure))) !== JSON.stringify(failure),
      ),
    ).toEqual([])
  })

  test("#given registered failures whose keys come in another order than the root rebuilds #when converted there and back #then the JSON text is identical, key order included", () => {
    const thread = {
      details: { probe: 1 },
      next_action: "n",
      message: "m",
      code: "not_found",
    } as unknown as ThreadToolFailure
    const remote = { code: "timeout", kind: "error", next_action: "n", message: "m" } as unknown as RemoteFailure
    expect(JSON.stringify(threadToolFailureOf(threadFailure(thread)))).toBe(JSON.stringify(thread))
    expect(JSON.stringify(remoteFailureOf(remoteFailure(remote)))).toBe(JSON.stringify(remote))
  })

  test("#given a producer's failure that already carries the reserved key in its details #when converted #then it is refused as internal_error, never read as a held code", () => {
    const forged = { [RESTORE_KEY]: "not_found", note: "x" }
    for (const converted of [
      threadFailure({ code: "invalid_arguments", message: "m", next_action: "n", details: forged }),
      remoteFailure({ kind: "error", code: "invalid_arguments", message: "m", next_action: "n", details: forged }),
    ]) {
      expect(converted.error.code).toBe("internal_error")
      expect(converted.error.message).toContain(RESTORE_KEY)
      expect(converted.error.details).toBeUndefined()
    }
  })
})
