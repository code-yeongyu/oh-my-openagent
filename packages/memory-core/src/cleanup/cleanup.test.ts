import { describe, expect, it } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { auditMemoryRepo } from "../audit/audit"
import { memory, repoWith } from "../compile/compile.test-support"
import { applyMemoryCleanup, MemoryCleanupStaleError } from "./apply"
import { author, exists, LESSON, lock, NOW, read, run } from "./cleanup.test-support"
import { planMemoryCleanup } from "./plan"
import { renderMemoryCleanupReport } from "./report"

describe("memory cleanup", () => {
  it("#given the same lesson written twice by two sessions #when applied #then one canonical keeps every paragraph, the copy is archived and links follow", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "reference/self/queue-depth-first-20261104.md", content: memory("Queue depth lesson", LESSON) },
      {
        relativePath: "reference/tooling/read-order-line-20261105.md",
        content: memory(
          "Order line lesson",
          `${LESSON}\n\nMeasured 2026-11-05 on two hosts: a 48-line queue at load 16.\n`,
        ),
      },
      {
        relativePath: "reference/project/lane-state.md",
        content: memory("Lane state", "See [[reference/self/queue-depth-first-20261104.md]] before placing."),
      },
      {
        relativePath: "reference/project/placement.md",
        content: memory("Placement", "Placement rule of record: [[reference/tooling/read-order-line-20261105.md]]."),
      },
      {
        relativePath: "reference/project/grants.md",
        content: memory(
          "Grants",
          "Grant handling follows [[reference/tooling/read-order-line-20261105.md]] on every host.",
        ),
      },
    ])

    // when
    const dry = await planMemoryCleanup(dir, { now: NOW })
    const { plan, applied } = await run(repo)

    // then
    expect(dry.findings.map((finding) => finding.class)).toEqual(["duplicate"])
    expect(plan.findings[0]?.related).toBe("reference/tooling/read-order-line-20261105.md")
    expect(applied.applied).toBe(true)
    expect(await exists(dir, "reference/self/queue-depth-first-20261104.md")).toBe(false)
    const archive = await read(dir, "ARCHIVE.md")
    expect(archive).toContain("## Archived reference/self/queue-depth-first-20261104.md (memory cleanup 2026-11-09)")
    expect(archive).toContain("- Reason: duplicate of reference/tooling/read-order-line-20261105.md")
    expect(archive).toContain("load average counts I/O-blocked threads")
    expect(await read(dir, "reference/project/lane-state.md")).toContain(
      "[[reference/tooling/read-order-line-20261105.md]]",
    )
    expect((await auditMemoryRepo(dir)).counts.link_dangling).toBe(0)
    expect(await repo.status()).toBe("")
  })

  it("#given a near-duplicate whose copy carries one extra paragraph #when applied #then the paragraph is appended verbatim to the canonical", async () => {
    // given
    const extra = "Measured once more on 2026-11-06: the same depth read on a third host."
    const { dir, repo } = await repoWith([
      { relativePath: "reference/a.md", content: memory("A", LESSON) },
      { relativePath: "reference/b.md", content: memory("B", `${LESSON}\n\n${extra}`) },
      {
        relativePath: "reference/c.md",
        content: memory("C", "Links: [[reference/a.md]] and [[reference/a.md]] again."),
      },
    ])

    // when
    const { plan } = await run(repo)

    // then
    const finding = plan.findings[0]
    expect(finding?.class).toBe("duplicate")
    expect(finding?.related).toBe("reference/a.md")
    expect(finding?.actions.map((action) => action.kind)).toEqual(["merge", "archive"])
    const canonical = await read(dir, "reference/a.md")
    expect(canonical).toContain("## Merged from reference/b.md (memory cleanup 2026-11-09)")
    expect(canonical).toContain(extra)
    expect(canonical.startsWith("---\ndescription: A\n---\n")).toBe(true)
  })

  it("#given a note that declares it supersedes an older one #when applied #then the older is archived naming its successor and the evidence line", async () => {
    // given
    const { dir, repo } = await repoWith([
      {
        relativePath: "reference/system/hc-off-roadmap-20261105.md",
        content: memory("hc off", "hc support is off the roadmap; ignore it."),
      },
      {
        relativePath: "reference/system/hc-back-on-roadmap-20261108.md",
        content: memory(
          "hc back",
          "hc is on the roadmap again. This note supersedes [[reference/system/hc-off-roadmap-20261105.md]].",
        ),
      },
      {
        relativePath: "reference/project/plan.md",
        content: memory("Plan", "Current ruling: [[reference/system/hc-off-roadmap-20261105.md]]."),
      },
    ])

    // when
    const { plan, applied } = await run(repo)

    // then
    expect(plan.findings).toHaveLength(1)
    expect(plan.findings[0]?.class).toBe("superseded")
    expect(plan.findings[0]?.evidence[0]?.at).toBe("reference/system/hc-back-on-roadmap-20261108.md:4")
    expect(applied.applied).toBe(true)
    const archive = await read(dir, "ARCHIVE.md")
    expect(archive).toContain("- Reason: superseded by reference/system/hc-back-on-roadmap-20261108.md")
    expect(archive).toContain("- Replaced by: [[reference/system/hc-back-on-roadmap-20261108.md]]")
    expect(archive).toContain("hc support is off the roadmap; ignore it.")
    expect(await read(dir, "reference/project/plan.md")).toContain(
      "[[ARCHIVE.md|reference/system/hc-off-roadmap-20261105.md (archived)]]",
    )
    expect((await auditMemoryRepo(dir)).counts.link_dangling).toBe(0)
  })

  it("#given a dated series where the newer note carries the older's paragraphs #when planned #then the older is superseded, and a diverging series is only kept", async () => {
    // given
    const body = (extra: string) => `${LESSON}\n\n${extra}`
    const { dir } = await repoWith([
      { relativePath: "reference/ops/host-state-20261104.md", content: memory("Host state 04", LESSON) },
      {
        relativePath: "reference/ops/host-state-20261105.md",
        content: memory("Host state 05", body("Newer measurement added on the fifth with the same depth reading.")),
      },
      {
        relativePath: "reference/ops/other-20261101.md",
        content: memory(
          "Other 01",
          "First paragraph about the relay sign-in path on the first host.\n\nSecond paragraph about the keychain prompt and its dialog.",
        ),
      },
      {
        relativePath: "reference/ops/other-20261102.md",
        content: memory(
          "Other 02",
          "A completely different paragraph about desktop release collection.\n\nAnother one about the notarization check order.",
        ),
      },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })

    // then
    expect(plan.findings.map((finding) => [finding.class, finding.subject, finding.related])).toEqual([
      ["superseded", "reference/ops/host-state-20261104.md", "reference/ops/host-state-20261105.md"],
    ])
    expect(plan.kept.map((note) => note.kind)).toEqual(["series-diverges"])
    expect(plan.kept[0]?.detail).toContain("0%")
  })

  it("#given an old note that is still true #when planned #then it is not stale, while an expired horizon and a LIFTED name are", async () => {
    // given
    const { dir } = await repoWith([
      {
        relativePath: "reference/ops/fleet-roster-20250101.md",
        content: memory("Fleet roster", "The fleet is three machines; this fact has not changed."),
      },
      {
        relativePath: "system/interim-hold-20261106.md",
        content: `---\ndescription: Interim hold\nexpires: 2026-11-07T13:30:00Z\n---\nHold every placement until the window closes.\n`,
      },
      {
        relativePath: "reference/ops/seoul-hold-20261105-LIFTED.md",
        content: memory("Seoul hold lifted", "The hold was lifted on the sixth."),
      },
      {
        relativePath: "system/still-open-20261101.md",
        content: `---\ndescription: Still open\nexpires: 2026-12-01\n---\nThis horizon has not passed.\n`,
      },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })

    // then
    expect(plan.findings.map((finding) => finding.subject).sort()).toEqual([
      "reference/ops/seoul-hold-20261105-LIFTED.md",
      "system/interim-hold-20261106.md",
    ])
    const expired = plan.findings.find((finding) => finding.subject === "system/interim-hold-20261106.md")
    expect(expired?.evidence[0]?.detail).toContain("expires: 2026-11-07T13:30:00Z passed")
    expect(plan.budget.tokensAfter).toBeLessThan(plan.budget.tokensBefore)
  })

  it("#given two notes that contradict each other #when applied twice #then both stay, both are marked, and the second run plans nothing", async () => {
    // given
    const { dir, repo } = await repoWith([
      {
        relativePath: "reference/rules/sionic-allowed.md",
        content: memory(
          "Allowed",
          "The work laptop takes receipt rows. This contradicts [[reference/rules/sionic-excluded.md]].",
        ),
      },
      {
        relativePath: "reference/rules/sionic-excluded.md",
        content: memory("Excluded", "The work laptop is out of scope for every receipt row."),
      },
    ])

    // when
    const first = await run(repo)
    const second = await run(repo)

    // then
    expect(first.plan.findings.map((finding) => finding.class)).toEqual(["conflict"])
    expect(first.applied.applied).toBe(true)
    expect(await read(dir, "reference/rules/sionic-allowed.md")).toContain(
      "conflicts_with: reference/rules/sionic-excluded.md",
    )
    expect(await read(dir, "reference/rules/sionic-excluded.md")).toContain(
      "conflicts_with: reference/rules/sionic-allowed.md",
    )
    expect(await read(dir, "reference/rules/sionic-excluded.md")).toContain("out of scope for every receipt row")
    expect(second.plan.findings).toEqual([])
    expect(second.plan.kept.map((note) => note.kind)).toEqual(["conflict-marked"])
    expect(second.applied).toEqual({ applied: false, reason: "nothing-to-do" })
  })

  it("#given every class at once #when applied and planned again #then the second plan has no findings and HEAD does not move", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "reference/a.md", content: memory("A", LESSON) },
      { relativePath: "reference/b.md", content: memory("B", LESSON) },
      { relativePath: "reference/old-20261101.md", content: memory("Old", "Ruling one about the relay.") },
      {
        relativePath: "reference/new-20261108.md",
        content: memory(
          "New",
          "Ruling two about the relay; superseded by nothing. [[reference/new-20261108.md]] supersedes [[reference/old-20261101.md]].",
        ),
      },
      { relativePath: "reference/gone-LIFTED.md", content: memory("Gone", "A hold that was lifted.") },
      { relativePath: "reference/x.md", content: memory("X", "X conflicts with [[reference/y.md]] on the port.") },
      { relativePath: "reference/y.md", content: memory("Y", "Y says the other port.") },
    ])

    // when
    const first = await run(repo)
    const head = await repo.head()
    const second = await run(repo)

    // then
    expect(first.plan.summary).toEqual({ archive: 3, merge: 0, mark: 2, repoint: 1 })
    expect(first.plan.budget.tokensAfter).toBe(first.plan.budget.tokensBefore)
    expect(second.plan.findings).toEqual([])
    expect(second.applied.applied).toBe(false)
    expect(await repo.head()).toBe(head)
    expect(await repo.status()).toBe("")
    expect((await auditMemoryRepo(dir)).counts.link_dangling).toBe(0)
  })

  it("#given a superseded note that system/human.md links to #when planned #then the finding is held, and applies only with the flag", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "system/human.md", content: memory("Human", "Standing rule: [[reference/old-20261101.md]].") },
      { relativePath: "system/persona.md", content: memory("Persona", "Who I am.") },
      { relativePath: "reference/old-20261101.md", content: memory("Old", "Ruling one.") },
      {
        relativePath: "reference/new-20261108.md",
        content: memory("New", "Ruling two. Supersedes [[reference/old-20261101.md]]."),
      },
      {
        relativePath: "reference/locked.md",
        content: `---\ndescription: Locked\nread_only: "true"\n---\nSee [[reference/old-20261101.md]].\n`,
      },
    ])

    // when
    const held = await planMemoryCleanup(dir, { now: NOW })
    const forced = await planMemoryCleanup(dir, { now: NOW, includeLoadBearing: true })
    const text = renderMemoryCleanupReport(held)

    // then
    expect(held.findings).toEqual([])
    expect(held.held[0]?.held).toContain("reference/locked.md, which is read_only")
    expect(forced.findings).toEqual([])
    expect(forced.held[0]?.held).toContain("read_only")
    expect(text).toContain("## held (1)")
    expect(await applyMemoryCleanup({ repo, lock, plan: held, author })).toEqual({
      applied: false,
      reason: "nothing-to-do",
    })
    expect(await read(dir, "system/human.md")).toContain("[[reference/old-20261101.md]]")
  })

  it("#given a supersession held because system/human.md links the old note #when that note also declares a conflict #then the conflict is still marked and the old note stays", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "system/human.md", content: memory("Human", "Standing rule: [[reference/old.md]].") },
      {
        relativePath: "reference/old.md",
        content: memory("Old", "The port is 443. This contradicts [[reference/other.md]]."),
      },
      {
        relativePath: "reference/new.md",
        content: memory("New", "The port is 443 still. Supersedes [[reference/old.md]]."),
      },
      { relativePath: "reference/other.md", content: memory("Other", "The port is 8443 for every receipt row.") },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })
    const applied = await applyMemoryCleanup({ repo, lock, plan, author })

    // then
    expect(plan.held.map((finding) => finding.class)).toEqual(["superseded"])
    expect(plan.findings.map((finding) => finding.class)).toEqual(["conflict"])
    expect(plan.kept.map((note) => note.kind)).not.toContain("party-archived")
    expect(applied.applied).toBe(true)
    if (applied.applied) expect(applied.removed).toEqual([])
    expect(await read(dir, "reference/old.md")).toContain("conflicts_with: reference/other.md")
    expect(await read(dir, "reference/other.md")).toContain("conflicts_with: reference/old.md")
    expect(await exists(dir, "ARCHIVE.md")).toBe(false)
    expect(await read(dir, "system/human.md")).toContain("[[reference/old.md]]")
  })

  it("#given only the load-bearing link #when planned with and without the flag #then the hold names system/human.md and the flag releases it", async () => {
    // given
    const { dir } = await repoWith([
      { relativePath: "system/human.md", content: memory("Human", "Standing rule: [[reference/old-20261101.md]].") },
      { relativePath: "reference/old-20261101.md", content: memory("Old", "Ruling one.") },
      {
        relativePath: "reference/new-20261108.md",
        content: memory("New", "Ruling two. Supersedes [[reference/old-20261101.md]]."),
      },
    ])

    // when
    const held = await planMemoryCleanup(dir, { now: NOW })
    const forced = await planMemoryCleanup(dir, { now: NOW, includeLoadBearing: true })

    // then
    expect(held.findings).toEqual([])
    expect(held.held[0]?.held).toBe(
      "would repoint a link in system/human.md (load-bearing; pass --include-load-bearing)",
    )
    expect(forced.findings.map((finding) => finding.subject)).toEqual(["reference/old-20261101.md"])
    expect(forced.findings[0]?.touches).toEqual([
      "ARCHIVE.md",
      "reference/new-20261108.md",
      "reference/old-20261101.md",
      "system/human.md",
    ])
  })

  it("#given a note edited after the report was written #when applied #then the plan is refused as stale and nothing is committed", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "reference/a.md", content: memory("A", LESSON) },
      { relativePath: "reference/b.md", content: memory("B", LESSON) },
    ])
    const plan = await planMemoryCleanup(dir, { now: NOW })
    const head = await repo.head()
    await writeFile(join(dir, "reference/b.md"), memory("B", `${LESSON}\n\nA new paragraph written after the report.`))
    await repo.commitWrite(["reference/b.md"], "edit b", author)

    // when
    const attempt = applyMemoryCleanup({ repo, lock, plan, author })

    // then
    await expect(attempt).rejects.toBeInstanceOf(MemoryCleanupStaleError)
    expect(await repo.head()).not.toBe(head)
    expect(await exists(dir, "reference/b.md")).toBe(true)
    expect(await exists(dir, "ARCHIVE.md")).toBe(false)
    expect(await repo.status()).toBe("")
  })

  it("#given a path a person vetoed #when planned with skip #then the finding is kept and the report says why", async () => {
    // given
    const { dir } = await repoWith([
      { relativePath: "reference/a.md", content: memory("A", LESSON) },
      { relativePath: "reference/b.md", content: memory("B", LESSON) },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW, skip: ["reference/b.md"], budgetTokens: 30_000 })
    const text = renderMemoryCleanupReport(plan)

    // then
    expect(plan.findings).toEqual([])
    expect(plan.kept[0]?.kind).toBe("skipped-by-option")
    expect(text).toContain("listed in --skip")
    expect(text).toContain("of 30000")
    expect(text).toContain("nothing to apply.")
  })
})
