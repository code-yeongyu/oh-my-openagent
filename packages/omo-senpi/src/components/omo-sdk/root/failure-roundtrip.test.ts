import { describe, expect, test } from "bun:test"

import { THREAD_ERROR_CODES, type ThreadToolFailure } from "../../thread/errors"
import { REMOTE_CODES } from "../../remote/codes"
import type { RemoteFailure } from "../../remote/types"
import { OMO_CODE_REGISTRY, type OmoFailure } from "../contract"
import { remoteFailure, remoteFailureOf } from "./remote-failures"
import { HELD_CODE, threadFailure, threadToolFailureOf } from "./thread-failures"

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

const threadFailures = THREAD_ERROR_CODES.flatMap((code) =>
  AWKWARD.map((details): ThreadToolFailure => ({
    code,
    message: `m ${code}`,
    next_action: `n ${code}`,
    ...(details === undefined ? {} : { details }),
  })),
)

const remoteFailures = REMOTE_CODES.flatMap((code) =>
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
      threadFailures.filter((failure) => !Bun.deepEquals(threadToolFailureOf(threadFailure(failure)), failure, true)),
    ).toEqual([])
  })

  test("#given every remote code crossed with awkward details #when converted to the root and back #then each is deeply equal", () => {
    expect(
      remoteFailures.filter((failure) => !Bun.deepEquals(remoteFailureOf(remoteFailure(failure)), failure, true)),
    ).toEqual([])
  })

  test("#given every registered root failure a thread code names, crossed with awkward details #when converted to the thread shape and back #then each is deeply equal", () => {
    const threadNamed = rootFailures.filter((failure) =>
      (THREAD_ERROR_CODES as readonly string[]).includes(failure.error.code),
    )
    expect(threadNamed.length).toBeGreaterThan(0)
    expect(
      threadNamed.filter((failure) => !Bun.deepEquals(threadFailure(threadToolFailureOf(failure)), failure, true)),
    ).toEqual([])
  })

  test("#given every registered root failure a remote code names, crossed with awkward details #when converted to the remote shape and back #then each is deeply equal", () => {
    const remoteNamed = rootFailures.filter((failure) =>
      (REMOTE_CODES as readonly string[]).includes(failure.error.code),
    )
    expect(remoteNamed.length).toBeGreaterThan(0)
    expect(
      remoteNamed.filter((failure) => !Bun.deepEquals(remoteFailure(remoteFailureOf(failure)), failure, true)),
    ).toEqual([])
  })

  test("#given a producer's failure that already carries the reserved key in its details #when converted #then it is refused as internal_error, never read as a held code", () => {
    const forged = { [HELD_CODE]: "not_found", note: "x" }
    for (const converted of [
      threadFailure({ code: "invalid_arguments", message: "m", next_action: "n", details: forged }),
      remoteFailure({ kind: "error", code: "invalid_arguments", message: "m", next_action: "n", details: forged }),
    ]) {
      expect(converted.error.code).toBe("internal_error")
      expect(converted.error.message).toContain(HELD_CODE)
      expect(converted.error.details).toBeUndefined()
    }
  })
})
