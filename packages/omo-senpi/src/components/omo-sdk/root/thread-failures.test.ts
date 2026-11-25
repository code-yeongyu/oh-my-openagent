import { describe, expect, test } from "bun:test"

import { THREAD_ERROR_CODES, threadToolFailure } from "../../thread/errors"
import { OMO_CODE_REGISTRY } from "../contract"
import { threadFailure, threadToolFailureOf } from "./thread-failures"

// Design 4.4: a thread failure converted to the root's shape and back is the failure it was, code, message, next_action
// and details, for every code the thread contract declares.
describe("the thread failure conversion", () => {
  for (const code of THREAD_ERROR_CODES)
    test(`${code}: round-trips unchanged, and reaches the root as a registered code`, () => {
      const original = threadToolFailure(code, `message for ${code}`, `next for ${code}`, { probe: 1 })
      const onRoot = threadFailure(original)
      expect(Object.hasOwn(OMO_CODE_REGISTRY, onRoot.error.code)).toBe(true)
      expect(threadToolFailureOf(onRoot)).toEqual(original)
    })

  test("#given a thread failure with no details #when it round-trips #then no details field appears", () => {
    const original = threadToolFailure("not_found", "gone", "list again")
    expect(threadToolFailureOf(threadFailure(original))).toEqual(original)
  })
})
