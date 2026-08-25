// The write-notice payload is DECORATION gathered after a committed memory write: every field is
// best-effort, so each degraded source must omit its own field and never fail, delay, or alter the
// model-facing result text.
import { describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createMemoryTools, gatherMemoryWriteNotice } from "./tools"
import { boundFixture, git, textOf, type BoundFixture } from "./tools.test-support"

const SESSION_ID = "session-write-notice"

async function writeJournalState(fixture: BoundFixture, body: string): Promise<void> {
  const dir = join(fixture.context.identityPaths.transcripts, SESSION_ID)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "state.json"), body, "utf8")
}

async function writeMergedCompletion(fixture: BoundFixture, finishedAt: string): Promise<void> {
  const dir = join(fixture.context.identityPaths.reflection, "completions")
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "run-1.json"),
    JSON.stringify({ runId: "run-1", outcome: "merged", finishedAt }),
    "utf8",
  )
}

function toolsFor(fixture: BoundFixture) {
  return createMemoryTools(() => fixture.context, {
    writeNotice: { enabled: true, resolveSessionId: () => SESSION_ID },
  })
}

describe("memory write notice gathering", () => {
  test("#given a committed write #when the tool result is built #then writeNotice carries raw sha, affected counts, size and timeline", async () => {
    // given
    const fixture = await boundFixture()
    await writeJournalState(fixture, JSON.stringify({ steps_since_last_successful_reflection: 7 }))
    await writeMergedCompletion(fixture, "2026-08-13T12:00:00.000Z")
    const [memoryTool] = toolsFor(fixture)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Track the deploy runbook",
      file_path: "knowledge/deploy.md",
      description: "How deploys run.",
      file_text: "line one\nline two\nline three",
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toMatch(/^Memory create committed locally \([0-9a-f]{7}\)\.$/)
    const notice = result.details.writeNotice
    expect(notice).toBeDefined()
    expect(notice?.sha).toBe(await git(fixture.repo, ["rev-parse", "HEAD"]))
    expect(notice?.subject).toBe("Track the deploy runbook")
    expect(notice?.identity).toBe(fixture.context.identity)
    expect(notice?.affected).toEqual([{ path: "knowledge/deploy.md", insertions: 6, deletions: 0 }])
    expect(notice?.size?.fileCount).toBeGreaterThan(0)
    expect(notice?.size?.totalBytes).toBeGreaterThan(0)
    expect(notice?.size?.systemBytes).toBeGreaterThanOrEqual(0)
    expect(notice?.timeline.entriesToday).toBeGreaterThanOrEqual(1)
    expect(notice?.timeline.lastConsolidationAtISO).toBe("2026-08-13T12:00:00.000Z")
    expect(notice?.timeline.unreflectedSteps).toBe(7)
  }, 60_000)

  test("#given the model-facing text #when a notice is attached #then content[0].text still carries only the tool message", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = toolsFor(fixture)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Track a fact",
      file_path: "knowledge/fact.md",
      description: "A fact.",
      file_text: "body",
    })

    // then
    expect(result.content).toHaveLength(1)
    expect(textOf(result)).toBe(result.details.message)
    expect(textOf(result)).not.toContain("entry today")
  }, 60_000)

  test("#given no prior commit before this write #when gathered #then previousEntryAtISO is omitted and nothing throws", async () => {
    // given a fresh repo whose seed commit is followed by exactly one memory write
    const fixture = await boundFixture()
    const [memoryTool] = toolsFor(fixture)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "First entry",
      file_path: "knowledge/first.md",
      description: "First.",
      file_text: "body",
    })
    const single = await gatherMemoryWriteNotice(fixture.context, {
      sha: await git(fixture.repo, ["rev-parse", "HEAD"]),
      subject: "First entry",
      affectedPaths: ["knowledge/first.md"],
    }, { sessionId: SESSION_ID, buildSnapshot: async () => ({ repo: {}, reflection: {}, journal: {} }) as never })

    // then
    expect(result.isError).toBeUndefined()
    expect(single.timeline.previousEntryAtISO).toBeUndefined()
    // The created block is frontmatter + body, so every line of the new file counts as an insertion.
    expect(single.affected).toEqual([{ path: "knowledge/first.md", insertions: 4, deletions: 0 }])
  }, 60_000)

  test("#given no reflection completions directory #when gathered #then lastConsolidationAtISO is omitted and nothing throws", async () => {
    // given
    const fixture = await boundFixture()
    await rm(join(fixture.context.identityPaths.reflection, "completions"), { recursive: true, force: true })
    const [memoryTool] = toolsFor(fixture)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "No consolidation yet",
      file_path: "knowledge/none.md",
      description: "None.",
      file_text: "body",
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(result.details.writeNotice).toBeDefined()
    expect(result.details.writeNotice?.timeline.lastConsolidationAtISO).toBeUndefined()
  }, 60_000)

  test("#given a corrupt journal state.json #when gathered #then unreflectedSteps is omitted and nothing throws", async () => {
    // given
    const fixture = await boundFixture()
    await writeJournalState(fixture, "{not json at all")
    const [memoryTool] = toolsFor(fixture)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Corrupt journal",
      file_path: "knowledge/corrupt.md",
      description: "Corrupt.",
      file_text: "body",
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(result.details.writeNotice).toBeDefined()
    expect(result.details.writeNotice?.timeline.unreflectedSteps).toBeUndefined()
  }, 60_000)

  test("#given git fails while reading line counts #when gathered #then affected is empty and nothing throws", async () => {
    // given
    const fixture = await boundFixture()

    // when
    const notice = await gatherMemoryWriteNotice(fixture.context, {
      sha: "0".repeat(40),
      subject: "Unreachable commit",
      affectedPaths: ["knowledge/ghost.md"],
    }, { sessionId: SESSION_ID })

    // then
    expect(notice.affected).toEqual([])
    expect(notice.sha).toBe("0".repeat(40))
    expect(notice.subject).toBe("Unreachable commit")
  }, 60_000)

  test("#given the whole snapshot read throws #when gathered #then size and timeline degrade without throwing", async () => {
    // given
    const fixture = await boundFixture()

    // when
    const notice = await gatherMemoryWriteNotice(fixture.context, {
      sha: "0".repeat(40),
      subject: "Broken snapshot",
      affectedPaths: [],
    }, {
      sessionId: SESSION_ID,
      buildSnapshot: async () => {
        throw new Error("snapshot exploded")
      },
    })

    // then
    expect(notice.size).toBeUndefined()
    expect(notice.timeline).toEqual({})
  }, 60_000)

  test("#given the write-notice gate is off #when the tool commits #then no writeNotice is attached", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context, {
      writeNotice: { enabled: false, resolveSessionId: () => SESSION_ID },
    })

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Gate off",
      file_path: "knowledge/gate.md",
      description: "Gate.",
      file_text: "body",
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(result.details.writeNotice).toBeUndefined()
  }, 60_000)

  test("#given memory_apply_patch commits #when the result is built #then it carries the same notice payload shape", async () => {
    // given
    const fixture = await boundFixture()
    const [, applyPatchTool] = toolsFor(fixture)

    // when
    const result = await applyPatchTool.execute("call-1", {
      reason: "Patch a new block",
      input: [
        "*** Begin Patch",
        "*** Add File: knowledge/patched.md",
        "+---",
        "+description: Patched.",
        "+---",
        "+",
        "+patched body",
        "*** End Patch",
      ].join("\n"),
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(result.details.writeNotice?.affected.map((entry) => entry.path)).toEqual(["knowledge/patched.md"])
  }, 60_000)
})

describe("memory tool result rendering", () => {
  test("#given both memory tools #when created #then each exposes a renderResult renderer", () => {
    // given / when
    const tools = createMemoryTools(() => undefined, { writeNotice: { enabled: true } })

    // then
    for (const tool of tools) expect(typeof tool.renderResult).toBe("function")
  })

  test("#given a committed write #when the row renders collapsed #then the local-commit line is replaced by the notice", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = toolsFor(fixture)

    // when
    const created = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Track the render path",
      file_path: "knowledge/render.md",
      description: "Render.",
      file_text: "body",
    })
    const renderResult = memoryTool.renderResult
    if (renderResult === undefined) throw new Error("memory renderResult is missing")
    const collapsed = (Reflect.apply(renderResult, undefined, [
      created,
      { expanded: false, isPartial: false },
      { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text },
      { isError: false },
    ]) as { render(width: number): string[] }).render(200)
    const expanded = (Reflect.apply(renderResult, undefined, [
      created,
      { expanded: true, isPartial: false },
      { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text },
      { isError: false },
    ]) as { render(width: number): string[] }).render(200)

    // then
    const collapsedText = collapsed.join("\n")
    expect(collapsedText).toContain("Memory updated")
    expect(collapsedText).not.toContain("committed locally")
    expect(collapsedText).not.toContain("create")
    expect(expanded.join("\n")).toContain(created.details.writeNotice?.sha.slice(0, 7) ?? "MISSING")
  }, 60_000)
})
