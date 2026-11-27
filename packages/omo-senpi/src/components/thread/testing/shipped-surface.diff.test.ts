import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CELLS, normalize, runCell } from "./shipped-surface-cells"

// The design lane's class check on T1a (ruling of record, 14:39Z and 14:45Z): every cell of the shipped thread surface
// answers at this head what it answers at the tip of dev, the branch that ships, except the cells DEV_AHEAD names.
//
// shipped-surface.dev.json is the dev capture: these cells run by this file with SHIPPED_SURFACE_CAPTURE=<path> in a clean
// checkout of dev with its own install (the cells file and the two-device fixture copied in), normalized as below.
// The first run compared three trees (dev 6cbb2133f0, the stack parent #14937 at 08c03295c9, and the head): the head
// equalled the parent on every cell, and the parent differed from dev on eight ThreadSdk.send cells. Four were #14937's own
// (a nested kind in a refusal's error), restored there; four are dev moving ahead of the stack, listed in DEV_AHEAD (with the cells added since: the same wake on more threads).
//
// T1a's held sites (thread/remote/held-answers.ts) keep dev's answers, so they add no difference here; the declared row
// (devices.resolve) and a session's root cells are not among these cells.

const REPO = join(import.meta.dir, "../../../../../..")
const DEV_CAPTURE = join(import.meta.dir, "shipped-surface.dev.json")

type DevAhead = { readonly commit: string; readonly why: string; readonly cells: readonly string[] }

/**
 * Cells where dev answers differently because dev moved past the stack's base. An entry leaves when its commit is merged
 * into this branch: the test below fails while an entry's commit is an ancestor of the head.
 */
const DEV_AHEAD: readonly DevAhead[] = [
  {
    commit: "223d85cfed",
    why: "train 12 (#14972): a send from the SDK wakes a parked session on this device, so an offline queue names wake_unavailable",
    cells: [
      "sdk send | another live here",
      "sdk send | ended here",
      "sdk send | here live",
      "sdk send keyed past the horizon | another live here",
      "sdk send keyed past the horizon | ended here",
      "sdk send keyed past the horizon | here live",
      "sdk send keyed twice | another live here",
      "sdk send keyed twice | ended here",
      "sdk send steer with turn 7, target idle | another live here",
      "sdk send steer with turn 7, target running turn 7 | another live here",
      "sdk send keyed twice | here live",
    ],
  },
]

const capture = process.env["SHIPPED_SURFACE_CAPTURE"]
const captured: Record<string, unknown> = {}
const devAhead = new Set(DEV_AHEAD.flatMap((entry) => entry.cells))

function isAncestor(commit: string): boolean | "unknown" {
  if (spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: REPO }).status !== 0) return "unknown"
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: REPO }).status === 0
}

afterAll(() => {
  if (capture !== undefined) writeFileSync(capture, `${JSON.stringify(captured, null, 2)}\n`)
})

describe("the shipped thread surface against dev", () => {
  const dev = capture === undefined ? (JSON.parse(readFileSync(DEV_CAPTURE, "utf8")) as Record<string, unknown>) : {}

  test("#given the cells and the dev capture #then they name the same cells, and every dev-ahead cell is one of them", () => {
    if (capture !== undefined) return
    const keys = CELLS.map((cell) => cell.key)
    expect(keys.toSorted()).toEqual(Object.keys(dev).toSorted())
    expect([...devAhead].filter((key) => !keys.includes(key))).toEqual([])
    // The compared surface is pinned (review of 5774980bda, LOW 1 and 2): a cell dropped from both CELLS and the capture,
    // or a regression silenced by listing its cells as dev-ahead, changes a number here. The one dev-ahead entry covers
    // SDK sends only (the wake it names), so a cell of any other kind cannot be listed under it.
    expect(keys.length).toBe(160)
    expect(devAhead.size).toBe(11)
    expect([...devAhead].filter((key) => !key.startsWith("sdk send"))).toEqual([])
  })

  test("#given an answer with a key that equals the run directory's name #when it is normalized #then the key is kept", () => {
    // Review of 5774980bda (LOW 4): run from a directory named "source", the unanchored rewrite turned every "source"
    // key into <cwd-name>, a false red. Only a whole value equal to the directory's name is a placeholder.
    expect(normalize({ source: "live_host", cwd: "source" }, "/work/source")).toEqual({
      source: "live_host",
      cwd: "<cwd-name>",
    })
  })

  test.each(CELLS.map((cell) => [cell.key, cell] as const))(
    "#given the cell %s #when it runs at this head #then it answers what dev answers, or differs where dev moved ahead",
    async (key, cell) => {
      const answer = normalize(await runCell(cell), process.cwd())
      if (capture !== undefined) {
        captured[key] = answer
        return
      }
      if (devAhead.has(key)) expect(answer).not.toEqual(dev[key])
      else expect(answer).toEqual(dev[key])
    },
  )

  test("#given the dev-ahead list #then no entry's commit is merged into this branch yet", () => {
    if (capture !== undefined) return
    const merged = DEV_AHEAD.filter((entry) => isAncestor(entry.commit) === true).map((entry) => entry.commit)
    expect(merged).toEqual([])
  })

  test("#given the dev capture #then the normalizer kept apart what answers differently", () => {
    if (capture !== undefined) return
    expect(existsSync(DEV_CAPTURE)).toBe(true)
    const dev = JSON.parse(readFileSync(DEV_CAPTURE, "utf8")) as Record<string, unknown>
    const distinct = new Set(Object.values(dev).map((answer) => JSON.stringify(answer)))
    expect(distinct.size).toBeGreaterThan(Object.keys(dev).length / 2)
    const apart = (a: string, b: string) => JSON.stringify(dev[a]) !== JSON.stringify(dev[b])
    expect({
      steer: apart(
        "tool thread_send steer with turn 7, target running turn 7 | b live",
        "tool thread_send steer without a turn id, target running turn 7 | b live",
      ),
      horizon: apart("tool thread_send keyed twice | b live", "tool thread_send keyed past the horizon | b live"),
      missing: apart("sdk read | here live", "sdk read | missing"),
    }).toEqual({ steer: true, horizon: true, missing: true })
  })
})
