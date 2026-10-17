import { describe, expect, test } from "bun:test"

import { deleteItem, isLive, renderItem } from "../item/index"
import { renderDocContent } from "../item/render"
import { splitItem } from "../item/frontmatter"
import { captureInto, newDoc } from "../item/test-support"
import { planAdoption, type ItemState } from "./index"
import { applyPlan, soleRegisters } from "./test-support"

const live = (currentText: string | null, lastMaterialised: string | null = null): ItemState => ({
  currentText,
  tombstoned: false,
  lastMaterialised,
  registers: soleRegisters(currentText)
})

describe("planAdoption (sync-design §3 insert-only adoption)", () => {
  test("a device enabling sync adopts a pre-existing memory file into a fresh item", async () => {
    const doc = await newDoc("1")
    const text = "---\ntitle: Daily log\n---\nwoke up, built the thing\n"
    const plan = planAdoption([{ path: "notes/daily.md", text }], live(null))
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    expect(plan.workingText).toBe(text)
    applyPlan(doc, "", plan)
    expect(renderItem(doc)).toBe(text)
    doc.free()
  })

  test("identical adoption adds nothing: two devices seeding the same file stay identical", async () => {
    const doc = await newDoc("1")
    const text = "---\ndescription: hello\n---\nbody\n"
    captureInto(doc, "", [], text)
    const plan = planAdoption([{ path: "system/persona.md", text }], live(renderDocContent(doc)))
    expect(plan.action).toBe("none")
    expect(renderItem(doc)).toBe(text)
    doc.free()
  })

  test("a file identical to the last materialised text is skipped; the space state is taken", async () => {
    const doc = await newDoc("1")
    const text = "alpha\nbeta\n"
    captureInto(doc, "", [], text)
    const plan = planAdoption([{ path: "n.md", text }], live(renderDocContent(doc), text))
    expect(plan.action).toBe("none")
    doc.free()
  })

  test("QA failure case: an unchanged file whose item is tombstoned is removed, not revived", async () => {
    const doc = await newDoc("1")
    const text = "alpha\nbeta\n"
    captureInto(doc, "", [], text)
    deleteItem(doc)
    expect(isLive(doc)).toBe(false)
    const plan = planAdoption([{ path: "n.md", text }], {
      currentText: renderDocContent(doc),
      tombstoned: true,
      lastMaterialised: text,
      registers: soleRegisters(renderDocContent(doc))
    })
    expect(plan.action).toBe("remove")
    expect(isLive(doc)).toBe(false)
    doc.free()
  })

  test("a changed file is adopted insert-only; nothing the space holds is deleted", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "alpha beta gamma\n")
    const current = renderDocContent(doc)
    const plan = planAdoption([{ path: "n.md", text: "alpha beta CHANGED gamma\n" }], live(current, "alpha beta gamma\n"))
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    applyPlan(doc, current, plan)
    const merged = renderItem(doc)
    expect(merged).toContain("alpha beta")
    expect(merged).toContain("CHANGED")
    expect(merged).toContain("gamma\n")
    doc.free()
  })

  test("a pure deletion in the working file applies nothing (insert-only)", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "alpha beta\n")
    const current = renderDocContent(doc)
    const plan = planAdoption([{ path: "n.md", text: "alpha\n" }], live(current, "alpha beta\n"))
    expect(plan.action).toBe("none")
    expect(renderItem(doc)).toBe("alpha beta\n")
    doc.free()
  })

  test("a changed file over a tombstone is an edit concurrent with the delete: the item stays", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "alpha beta\n")
    deleteItem(doc)
    expect(isLive(doc)).toBe(false)
    const current = renderDocContent(doc)
    const plan = planAdoption([{ path: "n.md", text: "alpha beta\ngamma\n" }], {
      currentText: current,
      tombstoned: true,
      lastMaterialised: "alpha beta\n",
      registers: soleRegisters(current)
    })
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    applyPlan(doc, current, plan)
    expect(isLive(doc)).toBe(true)
    expect(renderItem(doc)).toBe("alpha beta\ngamma\n")
    doc.free()
  })

  test("frontmatter keys are added and a differing value joins as a second whole value", async () => {
    const doc = await newDoc("1")
    captureInto(doc, "", [], "---\ntitle: space title\n---\nbody\n")
    const current = renderDocContent(doc)
    const plan = planAdoption(
      [{ path: "n.md", text: "---\ntitle: local title\nmood: reflective\n---\nbody\nplus\n" }],
      live(current, null),
    )
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    applyPlan(doc, current, plan)
    const rendered = renderItem(doc)
    expect(rendered).toContain('title: "local title / space title"')
    expect(rendered).toBe(plan.rendered)
    expect(rendered).toContain("mood: reflective")
    expect(rendered).toContain("plus")
    doc.free()
  })

  test("case-fold collision: two paths folding to one key are both adopted", async () => {
    const doc = await newDoc("1")
    const plan = planAdoption(
      [
        { path: "Notes.md", text: "---\ntitle: upper\n---\nalpha one\n" },
        { path: "notes.md", text: "---\nmood: calm\n---\nbeta two\n" },
      ],
      live(null),
    )
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    applyPlan(doc, "", plan)
    const rendered = renderItem(doc)
    expect(rendered).toContain("title: upper")
    expect(rendered).toContain("mood: calm")
    expect(rendered).toContain("alpha one\n")
    expect(rendered).toContain("beta two\n")
    doc.free()
  })
})

describe("HIGH-1 regression: a fact is never dropped while its source is deleted", () => {
  test("P1: a side line sharing characters with the body is still adopted", () => {
    const plan = planAdoption(
      [
        { path: "n.md", text: "- likes coffee\n- hates tea\n" },
        { path: "n.sync-conflict-20261015-mac.md", text: "- likes tea\n" },
      ],
      live("- likes coffee\n- hates tea\n", null),
    )
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    expect(plan.workingText).toContain("- likes tea\n")
    expect(plan.workingText).toContain("- hates tea\n")
    expect(plan.removalCandidates).toEqual(["n.sync-conflict-20261015-mac.md"])
  })

  test("P1b: prose whose characters are scattered across other lines is still adopted", () => {
    const plan = planAdoption(
      [
        { path: "n.md", text: "I do not like tea anymore.\n" },
        { path: "n.sync-conflict-20261015-mac.md", text: "I like tea.\n" },
      ],
      live("I do not like tea anymore.\n", null),
    )
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    expect(plan.workingText).toContain("I like tea.\n")
    expect(plan.workingText).toContain("I do not like tea anymore.\n")
  })

  test("P2: a history-less main file is always line-merged", () => {
    const plan = planAdoption([{ path: "n.md", text: "ax\n" }], live("abc\nxyz\n", null))
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    expect(plan.workingText).toContain("abc\nxyz\n")
    expect(plan.workingText).toContain("ax\n")
  })

  test("a CRLF side file's frontmatter keys survive adoption", () => {
    const plan = planAdoption(
      [{ path: "n.sync-conflict-20261015-mac.md", text: "---\r\ntitle: 茶 log\r\ntags: [a, b]\r\n---\r\nkept line\r\n" }],
      live("- base line\n", null),
    )
    expect(plan.action).toBe("capture")
    if (plan.action !== "capture") return
    const parsed = splitItem(plan.workingText)
    expect(parsed.fm?.map((entry) => entry.key)).toEqual(["title", "tags"])
    expect(plan.workingText).toContain("kept line\n")
    expect(plan.workingText.includes("\r")).toBe(false)
    expect(plan.removalCandidates).toEqual(["n.sync-conflict-20261015-mac.md"])
  })
})
