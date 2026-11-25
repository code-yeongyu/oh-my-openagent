import { expect, test } from "bun:test"

import { OMO_CODE_REGISTRY } from "../../omo-senpi/src/components/omo-sdk/contract/index.ts"
import { exitOf } from "../../omo-senpi/src/components/omo-sdk/exit/index.ts"
import { SURFACE_EXITS } from "../../omo-senpi/src/components/omo-sdk/exit/surfaces.ts"
import { exitOf as commandExitOf, REAP_EXIT_SURFACE } from "../bin/lib/reap-exit.js"

const surface = SURFACE_EXITS["doctor"]

// Design 4.4: omo doctor's surface in the SDK's exit projection answers exactly what the command prints today. Every
// refusal of every doctor call exits 1, as reap-exit.js projects it for --reap and the report, --fix and --models print.
test("#given omo doctor's surface #when every registered code is projected #then each exits as the command does", () => {
  if (surface === undefined) throw new Error("doctor has no exit surface")
  const codes = [...Object.keys(OMO_CODE_REGISTRY), "not_implemented"]
  expect(
    codes.filter(
      (code) =>
        exitOf(surface, { kind: "error", error: { code } }) !==
        commandExitOf(REAP_EXIT_SURFACE, { kind: "error", error: { code } }),
    ),
  ).toEqual([])
})

// The successes the goldens pin: a healthy and a degraded report, a sweep with and without a failed step, a reap that
// signalled every named pid and one that refused one, and the model view.
test("#given each pinned success of omo doctor #when its answer is projected #then the exit is the pinned one", () => {
  if (surface === undefined) throw new Error("doctor has no exit surface")
  const pinned: readonly (readonly [string, unknown, number])[] = [
    ["healthy report", { findings: [], failed: false }, 0],
    ["degraded report", { findings: [], failed: true }, 1],
    ["sweep with nothing to fix", { dry_run: false, entries: [], failed: false }, 0],
    ["sweep with a failed step", { dry_run: false, entries: [], failed: true }, 1],
    ["reap of every named pid", { engines: [], complete: true }, 0],
    ["reap that refused a named pid", { engines: [], complete: false }, 1],
    ["model view", { excludeModels: [], categories: [], agents: [] }, 0],
  ]
  expect(pinned.map(([name, value]) => [name, exitOf(surface, { kind: "ok", value })])).toEqual(
    pinned.map(([name, , exit]) => [name, exit]),
  )
  for (const complete of [true, false])
    expect(exitOf(surface, { kind: "ok", value: { engines: [], complete } })).toBe(
      commandExitOf(REAP_EXIT_SURFACE, { kind: "ok", value: { engines: [], complete } }),
    )
})
