import { describe, expect, test } from "bun:test"

import { REMOTE_CODES } from "../../remote/codes"
import type { RemoteFailure } from "../../remote/types"
import { OMO_CODE_REGISTRY } from "../contract"
import { remoteFailure, remoteFailureOf } from "./remote-failures"

// Design 4.4: the remote module's flat failure converted to the root's shape and back is the failure it was, for every
// code it declares, with uncertain, command_id, partial and details carried by value.
describe("the remote failure conversion", () => {
  for (const code of REMOTE_CODES)
    test(`${code}: round-trips unchanged with every first-class field, and reaches the root as a registered code`, () => {
      const original: RemoteFailure = {
        kind: "error",
        code,
        message: `message for ${code}`,
        next_action: `next for ${code}`,
        uncertain: true,
        command_id: "cmd-1",
        partial: { rows: [1] },
        details: { probe: 1 },
      }
      const onRoot = remoteFailure(original)
      expect(Object.hasOwn(OMO_CODE_REGISTRY, onRoot.error.code)).toBe(true)
      expect(remoteFailureOf(onRoot)).toEqual(original)
    })

  test("#given a remote failure with only its required fields #when it round-trips #then no optional field appears", () => {
    const original: RemoteFailure = { kind: "error", code: "timeout", message: "late", next_action: "retry" }
    expect(remoteFailureOf(remoteFailure(original))).toEqual(original)
  })
})
