import { expect, test } from "bun:test"

import { OMO_CODE_REGISTRY } from "../../omo-senpi/src/components/omo-sdk/contract/index.ts"
import { exitOf } from "../../omo-senpi/src/components/omo-sdk/exit/index.ts"
import { SURFACE_EXITS } from "../../omo-senpi/src/components/omo-sdk/exit/surfaces.ts"
import { exitOf as renderedExit, INSTALL_UPDATE_EXITS } from "../bin/lib/install-calls.js"

// Design 4.4: omo update's surface in the SDK's exit projection answers exactly what its renderer exits with today, for
// success, every registered code, every closed install_failed reason and a passed-through status at its bounds.
test("#given omo update's surface #when every code and reason is projected #then each equals the renderer's exit", () => {
  const surface = SURFACE_EXITS["update"]
  if (surface === undefined) throw new Error("update has no exit surface")
  expect(exitOf(surface, { kind: "ok" })).toBe(renderedExit(INSTALL_UPDATE_EXITS, undefined))
  const failures = [
    ...[...Object.keys(OMO_CODE_REGISTRY), "not_implemented"].map((code) => ({ code })),
    ...(OMO_CODE_REGISTRY.install_failed.reasons ?? []).flatMap((reason) =>
      [undefined, 0, 1, 3, 255, 256, 2.5].map((exit_status) => ({
        code: "install_failed",
        details: exit_status === undefined ? { reason } : { reason, exit_status },
      })),
    ),
  ]
  expect(
    failures.filter(
      (failure) => exitOf(surface, { kind: "error", error: failure }) !== renderedExit(INSTALL_UPDATE_EXITS, failure),
    ),
  ).toEqual([])
})
