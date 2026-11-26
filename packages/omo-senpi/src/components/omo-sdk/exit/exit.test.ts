import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { exitCodeOf, REMOTE_CODES } from "../../remote/codes"
import { OMO_CODE_REGISTRY } from "../contract"
import { decidedCodes, exitOf, type SurfaceExits } from "."
import { SURFACE_EXITS } from "./surfaces"

// Design 4.4 and the design lane's conditions on the slot: each surface answers exactly the exit its command prints
// today, decides every registered code (and every reason of a code with a closed reason set) explicitly, bounds a
// passed-through status, and every served row's CLI entry has a surface.
const registered = Object.keys(OMO_CODE_REGISTRY)
const surfaces = [...new Set(Object.values(SURFACE_EXITS))]

describe("the exit projection keyed by surface", () => {
  test("#given omo remote's surface #when success and every code either side knows are projected #then each equals exitCodeOf", () => {
    const surface = SURFACE_EXITS["remote send"] as SurfaceExits
    expect(exitOf(surface, { kind: "ok" })).toBe(exitCodeOf(undefined))
    const codes = [...new Set([...registered, ...REMOTE_CODES])]
    const differ = codes.filter(
      (code) =>
        exitOf(surface, { kind: "error", error: { code } }) !==
        exitCodeOf({ kind: "error", code, message: "", next_action: "" } as never),
    )
    expect(differ).toEqual([])
  })

  test("#given every surface #when the registry's codes and their closed reasons are walked #then each is decided by a rule or the refused list", () => {
    const undecided = surfaces.flatMap((surface) => {
      const decided = decidedCodes(surface)
      return Object.entries(OMO_CODE_REGISTRY).flatMap(([code, entry]) => {
        if (!decided.has(code)) return [code]
        const reasons = (entry as { readonly reasons?: readonly string[] }).reasons ?? []
        if (surface.refused.codes.includes(code)) return []
        const ruled = new Set(
          surface.rules.filter((rule) => rule.code === code).map((rule) => rule.details?.["reason"]),
        )
        return ruled.has(undefined)
          ? []
          : reasons.filter((reason) => !ruled.has(reason)).map((reason) => `${code}/${reason}`)
      })
    })
    expect(undecided).toEqual([])
  })

  test("#given a made-up surface with a pass-through rule #when the status is 0, negative, above 255 or not an integer #then the rule is skipped and never exits 0", () => {
    const surface: SurfaceExits = {
      ok: 0,
      refused: { exit: 1, codes: [] },
      rules: [
        { code: "probe_failed", details: { step: "child" }, exitFrom: "status" },
        { code: "probe_failed", details: { step: "lock" }, exit: 9 },
        { code: "probe_failed", exit: 8 },
      ],
    }
    const failed = (details: Record<string, unknown>) =>
      exitOf(surface, { kind: "error", error: { code: "probe_failed", details } })
    expect([1, 42, 255].map((status) => failed({ step: "child", status }))).toEqual([1, 42, 255])
    expect([0, -3, 256, 2.5, "7"].map((status) => failed({ step: "child", status }))).toEqual([8, 8, 8, 8, 8])
    expect(failed({ step: "lock" })).toBe(9)
    expect(exitOf(surface, { kind: "error", error: { code: "not_found" } })).toBe(1)
  })

  test("#given a made-up surface with success rules #when results are projected #then the first rule whose top-level fields all equal decides and any other success exits ok", () => {
    const surface: SurfaceExits = {
      ok: 0,
      okRules: [
        { result: { complete: false, dry_run: false }, exit: 1 },
        { result: { complete: false }, exit: 2 },
      ],
      refused: { exit: 1, codes: [] },
      rules: [],
    }
    const exit = (value: unknown) => exitOf(surface, { kind: "ok", value })
    expect([
      exit({ complete: false, dry_run: false }),
      exit({ complete: false, dry_run: true }),
      exit({ complete: true }),
      exit("text"),
      exit(undefined),
    ]).toEqual([1, 2, 0, 0, 0])
  })

  test("#given every surface #when its fixed exits are read #then each is an integer from 0 to 255 and its success without a result exits ok", () => {
    const exits = surfaces.flatMap((surface) => [
      surface.ok,
      surface.refused.exit,
      ...(surface.okRules ?? []).map((rule) => rule.exit),
      ...surface.rules.flatMap((rule) => ("exit" in rule ? [rule.exit] : [])),
    ])
    expect(exits.filter((exit) => !Number.isInteger(exit) || exit < 0 || exit > 255)).toEqual([])
    expect(surfaces.map((surface) => exitOf(surface, { kind: "ok" }))).toEqual(surfaces.map((surface) => surface.ok))
  })
})

type Row = {
  readonly id: string
  readonly kind: string
  readonly cli: readonly { readonly route: readonly string[]; readonly edition: string }[]
}
const PARITY = join(import.meta.dir, "../../../../../../script/sdk-parity")
const rows = readdirSync(join(PARITY, "rows"))
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) => (JSON.parse(readFileSync(join(PARITY, "rows", name), "utf8")) as { rows: Row[] }).rows)
const unresolved = new Set(
  (JSON.parse(readFileSync(join(PARITY, "unresolved.json"), "utf8")) as { entries: { id: string }[] }).entries.map(
    (entry) => entry.id,
  ),
)
// A CLI entry of an edition whose part of the row is an open edition gap (edition-gaps.json) is not served by the root
// yet: that edition's own command still answers it, so it needs no surface until the gap's slice builds it.
const gapped = new Set(
  (
    JSON.parse(readFileSync(join(PARITY, "edition-gaps.json"), "utf8")) as {
      entries: { row: string; edition: string }[]
    }
  ).entries.map((gap) => `${gap.row} ${gap.edition}`),
)
const withoutSurface = (served: boolean) =>
  rows
    .filter((row) => row.kind === "capability" && unresolved.has(row.id) !== served)
    .flatMap((row) =>
      row.cli
        .filter((entry) => !gapped.has(`${row.id} ${entry.edition}`))
        .map((entry) => entry.route.join(" "))
        .filter((route) => route !== ""),
    )
    .filter((route) => SURFACE_EXITS[route] === undefined)

test("#given the served rows #when their CLI entries are listed #then each has an exit surface (the unresolved ones are only reported)", () => {
  const pending = [...new Set(withoutSurface(false))].toSorted()
  if (pending.length > 0) console.info(`exit surfaces still to add for unresolved rows: ${pending.join(", ")}`)
  expect([...new Set(withoutSurface(true))]).toEqual([])
})
