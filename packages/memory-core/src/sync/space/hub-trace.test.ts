import { describe, expect, test } from "bun:test"

import { activeRegisters } from "../item/index"
import { renderDocContent } from "../item/render"
import { splitItem } from "../item/frontmatter"
import { newDoc } from "../item/test-support"
import { groupByItemKey, isOrderedSubsequence, parseSyncConflictName, planAdoption, stripT2Blocks } from "./index"
import { applyPlan, fmValuesByKey, t2Block, soleRegisters } from "./test-support"

describe("parseSyncConflictName (hub worktree-merge keepSideCopy shape)", () => {
  const hits: readonly (readonly [string, string])[] = [
    ["notes/a.sync-conflict-20261015-mini.md", "notes/a.md"],
    ["x.sync-conflict-20261015-host", "x"],
    ["archive.tar.sync-conflict-20261015-mac.gz", "archive.tar.gz"],
    ["a.sync-conflict-20261015-.md", "a.md"],
    ["people/hojin/card.sync-conflict-20260101-jobdori2.md", "people/hojin/card.md"],
  ]
  for (const [input, target] of hits) {
    test(`${input} targets ${target}`, () => {
      const parsed = parseSyncConflictName(input)
      expect(parsed).not.toBeNull()
      expect(parsed?.target).toBe(target)
    })
  }

  test("captures day and label", () => {
    const parsed = parseSyncConflictName("a.sync-conflict-20261015-mini.md")
    expect(parsed?.day).toBe("20261015")
    expect(parsed?.label).toBe("mini")
  })

  const misses = [
    "a.md",
    "a.sync-conflict-2026101-x.md",
    "a.sync-conflict-2026-10-15-x.md",
    "a.sync-conflict-20261015-x y.md",
    "a.sync-conflict-20261015-x.md.bak",
    ".sync-conflict-20261015-x.md",
  ]
  for (const input of misses) {
    test(`${input} is not a side file`, () => {
      expect(parseSyncConflictName(input)).toBeNull()
    })
  }
})

describe("groupByItemKey", () => {
  test("case-fold duplicates and T1 side files land in the target's group", () => {
    const groups = groupByItemKey(["Notes.md", "notes.md", "Notes.sync-conflict-20261015-mini.md", "other.md"])
    expect(groups.get("notes.md")).toEqual(["Notes.md", "notes.md", "Notes.sync-conflict-20261015-mini.md"])
    expect(groups.get("other.md")).toEqual(["other.md"])
  })

  test("paths that can never be items are dropped", () => {
    const groups = groupByItemKey(["../escape.md", "/abs.md", "ok.md"])
    expect([...groups.keys()]).toEqual(["ok.md"])
  })
})

describe("stripT2Blocks (hub md-merge-driver pickFrontmatter shape)", () => {
  test("a well-formed block is parsed as frontmatter and removed from the body", () => {
    const fm = "---\nreviewed: true\nnote: kept\n---\n"
    const body = `first line\n${t2Block("2026-10-15", "notes/daily.md", fm)}last line\n`
    const r = stripT2Blocks(body)
    expect(r.body).toBe("first line\nlast line\n")
    expect(r.malformed).toEqual([])
    const values = fmValuesByKey(r.entries)
    expect(values.get("reviewed")).toEqual({ kind: "reg", value: "true" })
    expect(values.get("note")).toEqual({ kind: "reg", value: "kept" })
  })

  test("the emitter's --> escaping is reversed before parsing", () => {
    const fm = "---\ncomment: a --> b\n---\n"
    const r = stripT2Blocks(`x\n${t2Block("2026-10-15", "n.md", fm)}`)
    expect(fmValuesByKey(r.entries).get("comment")).toEqual({ kind: "reg", value: "a --> b" })
    expect(r.body).toBe("x\n")
  })

  test("QA failure case: a malformed T2 block stays untouched", () => {
    const bad = "\n<!-- memory-sync 2026-10-15: the other machine had different frontmatter for n.md; kept here so no fact is lost:\n---\n: [unclosed\n---\n-->\n"
    const r = stripT2Blocks(`keep me\n${bad}after\n`)
    expect(r.entries).toEqual([])
    expect(r.malformed).toEqual([bad])
    expect(r.body).toBe(`keep me\n${bad}after\n`)
  })

  test("a T2 block at the very start of the body is folded too", () => {
    const fm = "---\nreviewed: true\n---\n"
    const r = stripT2Blocks(`${t2Block("2026-10-15", "n.md", fm).slice(1)}tail\n`)
    expect(r.entries.map((entry) => entry.key)).toEqual(["reviewed"])
    expect(r.body).toBe("tail\n")
  })

  test("a comment that only resembles a T2 block is not touched", () => {
    const body = "a\n<!-- memory-sync 2026-10-15: something else entirely -->\nb\n"
    const r = stripT2Blocks(body)
    expect(r.body).toBe(body)
    expect(r.entries).toEqual([])
    expect(r.malformed).toEqual([])
  })

  test("removal of keys is never adopted from a marker", () => {
    const fm = "---\nobsolete: null\n---\n"
    const r = stripT2Blocks(`x\n${t2Block("2026-10-15", "n.md", fm)}`)
    expect(r.entries).toEqual([])
    expect(r.body).toBe("x\n")
  })
})

describe("hub-trace folding end to end (fixture shaped like real hub output)", () => {
  const mainText =
    "---\ntitle: Daily log\nauthor: Dori\n---\nwoke up, built the thing\n" +
    t2Block("2026-10-15", "notes/daily.md", "---\nreviewed: true\n---\n")
  const sideText = "---\ntitle: Daily log\nreviewed: true\n---\nshipped the cutover; reviewed the queue\n"

  function files() {
    return [
      { path: "notes/daily.md", text: mainText },
      { path: "notes/daily.sync-conflict-20261015-mini.md", text: sideText },
    ]
  }

  test("T1 folds the side file in insert-only and schedules its removal; T2 lands as frontmatter", async () => {
    const doc = await newDoc("1")
    const plan = planAdoption(files(), { currentText: null, tombstoned: false, lastMaterialised: null, registers: soleRegisters(null) })
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    expect(plan.removalCandidates).toEqual(["notes/daily.sync-conflict-20261015-mini.md"])
    applyPlan(doc, "", plan)
    const rendered = renderDocContent(doc)
    expect(rendered).toBe(plan.rendered)
    const parsed = splitItem(rendered)

    const preBody = splitItem(mainText).body.replace(t2Block("2026-10-15", "notes/daily.md", "---\nreviewed: true\n---\n"), "")
    expect(isOrderedSubsequence(preBody, parsed.body)).toBe(true)
    expect(isOrderedSubsequence(splitItem(sideText).body, parsed.body)).toBe(true)
    expect(parsed.body).not.toContain("<!-- memory-sync")

    const values = fmValuesByKey(parsed.fm ?? [])
    expect(values.get("title")).toEqual({ kind: "reg", value: "Daily log" })
    expect(values.get("author")).toEqual({ kind: "reg", value: "Dori" })
    expect(values.get("reviewed")).toEqual({ kind: "reg", value: "true" })
    doc.free()
  })

  test("the fold is idempotent against the adopted state", async () => {
    const doc = await newDoc("1")
    const first = planAdoption(files(), { currentText: null, tombstoned: false, lastMaterialised: null, registers: soleRegisters(null) })
    if (first.action !== "capture") throw new Error("expected capture")
    applyPlan(doc, "", first)
    const second = planAdoption(files(), {
      currentText: renderDocContent(doc),
      tombstoned: false,
      lastMaterialised: null,
      registers: activeRegisters(doc)
    })
    expect(second.action).toBe("none")
    doc.free()
  })
})
