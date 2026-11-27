import { expect, test } from "bun:test"

import { exitOf } from "../../omo-senpi/src/components/omo-sdk/exit/index.ts"
import { SURFACE_EXITS } from "../../omo-senpi/src/components/omo-sdk/exit/surfaces.ts"
import { OMO_CODE_REGISTRY } from "../../omo-senpi/src/components/omo-sdk/contract/index.ts"
import { threadExitCode } from "../bin/lib/thread.js"

// Design 4.4: omo thread's surface in the SDK's exit projection answers exactly what threadExitCode prints today.
test("#given omo thread's surface #when success and every registered code are projected #then each equals threadExitCode", () => {
  const surface = SURFACE_EXITS["thread send"]
  if (surface === undefined) throw new Error("thread send has no exit surface")
  expect(exitOf(surface, { kind: "ok" })).toBe(threadExitCode({ kind: "ok" }))
  const codes = [...Object.keys(OMO_CODE_REGISTRY), "not_implemented"]
  expect(
    codes.filter(
      (code) =>
        exitOf(surface, { kind: "error", error: { code } }) !== threadExitCode({ kind: "error", error: { code } }),
    ),
  ).toEqual([])
})
