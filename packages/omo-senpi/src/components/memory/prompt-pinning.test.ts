import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { MemoryBlockCache, type GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { MemoryIdentityContext } from "./context"
import { createMemoryPromptHandler } from "./prompt"
import {
  IDENTITY,
  beforeAgentStart,
  compactedBranch,
  dispatchEvent,
  eventContext,
  fixture,
  fixtureAtSystemTokens,
  liveBranch,
} from "./prompt.test-support"
import {
  MEMORY_CHANGES_METADATA_TOKEN,
  PROJECTION_PIN_ENTRY_TYPE,
  createProjectionPins,
  type ProjectionPinRecord,
  type ProjectionPins,
} from "./projection-pin"
import { MEMORY_PRESSURE_METADATA_TOKEN } from "./prompt"

const SESSION = "session-1"

async function commitAs(repo: GitMemoryRepo, sessionId: string, path: string, body: string): Promise<void> {
  await mkdir(dirname(join(repo.dir, path)), { recursive: true })
  await writeFile(join(repo.dir, path), `---\ndescription: ${path}\n---\n${body}\n`)
  await repo.commitWrite(
    [path],
    `record ${path}\n\nOmo-Writer: memory-tool\nOmo-Session: ${sessionId}\nOmo-Turn: 1`,
    { agentId: IDENTITY, authorName: "Prompt Agent" },
  )
}

function pinnedHandler(
  repo: GitMemoryRepo,
  context: MemoryIdentityContext,
  overrides: { pins?: ProjectionPins; resolveCompileWarnTokens?: () => number } = {},
) {
  const records: ProjectionPinRecord[] = []
  const repins: string[] = []
  const pi = new FakeExtensionAPI()
  pi.on("before_agent_start", createMemoryPromptHandler({
    resolveContext: () => context,
    createRepo: () => repo,
    cache: new MemoryBlockCache(),
    pins: overrides.pins ?? createProjectionPins(),
    recordPin: (record) => records.push(record),
    onRepin: (_sessionId, reason) => repins.push(reason),
    ...(overrides.resolveCompileWarnTokens === undefined ? {} : { resolveCompileWarnTokens: overrides.resolveCompileWarnTokens }),
  }))
  const dispatch = (branch: readonly unknown[], sessionId = SESSION) =>
    dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext(sessionId, branch))
  return { dispatch, records, repins }
}

function pinEntry(record: ProjectionPinRecord | undefined): Record<string, unknown> {
  return { type: "custom", id: "pin-entry", customType: PROJECTION_PIN_ENTRY_TYPE, data: record }
}

describe("session-pinned memory projection", () => {
  test("#given another writer adds a file and edits persona between turns #when the next turns run #then the system prompt keeps its bytes and the change is announced once", async () => {
    // given
    const { repo, context } = await fixture()
    const { dispatch } = pinnedHandler(repo, context)
    const first = await dispatch(liveBranch(1))

    // when
    await commitAs(repo, "other-session", "reference/new.md", "new")
    await commitAs(repo, "other-session", "system/persona.md", "second")
    const second = await dispatch(liveBranch(2))
    const third = await dispatch(liveBranch(3))

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(third?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.systemPrompt).not.toContain("second")
    expect(second?.message?.content).toContain(MEMORY_CHANGES_METADATA_TOKEN)
    expect(second?.message?.content).toContain("added reference/new.md")
    expect(second?.message?.content).toContain("updated system/persona.md")
    expect(third?.message).toBeUndefined()
  }, 30_000)

  test("#given a commit this session wrote itself #when the next turn runs #then nothing is announced and the prompt keeps its bytes", async () => {
    // given
    const { repo, context } = await fixture()
    const { dispatch } = pinnedHandler(repo, context)
    const first = await dispatch(liveBranch(1))

    // when
    await commitAs(repo, SESSION, "reference/mine.md", "mine")
    const second = await dispatch(liveBranch(2))

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message).toBeUndefined()
  }, 30_000)

  test("#given a commit after one session pinned #when a new session starts #then the new session compiles the new HEAD", async () => {
    // given
    const { repo, context } = await fixture()
    const { dispatch } = pinnedHandler(repo, context)
    await dispatch(liveBranch(1))
    await commitAs(repo, "other-session", "system/persona.md", "second")

    // when
    const fresh = await dispatch(liveBranch(1), "session-2")

    // then
    expect(fresh?.systemPrompt).toContain("second")
  }, 30_000)

  test("#given a persisted pin #when a new handler resumes the session after a commit #then it reproduces the pinned bytes and announces the change once", async () => {
    // given
    const { repo, context } = await fixture()
    const original = pinnedHandler(repo, context)
    const first = await original.dispatch(liveBranch(1))
    await commitAs(repo, "other-session", "reference/new.md", "new")

    // when
    const resumed = pinnedHandler(repo, context)
    const branch = [...liveBranch(1), pinEntry(original.records.at(-1))]
    const second = await resumed.dispatch(branch)

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message?.content).toContain("added reference/new.md")
    expect(resumed.repins).toEqual([])
  }, 30_000)

  test("#given a compaction lands after the pin #when the next turn runs #then the session repins to HEAD", async () => {
    // given
    const { repo, context } = await fixture()
    const { dispatch, repins } = pinnedHandler(repo, context)
    await dispatch(liveBranch(1))
    await commitAs(repo, "other-session", "system/persona.md", "second")

    // when
    const afterCompaction = await dispatch(compactedBranch(2))

    // then
    expect(afterCompaction?.systemPrompt).toContain("second")
    expect(afterCompaction?.message?.content ?? "").not.toContain(MEMORY_CHANGES_METADATA_TOKEN)
    expect(repins).toEqual(["compaction"])
  }, 30_000)

  test("#given /recompile requested a refresh #when the next turn runs #then the session repins to HEAD", async () => {
    // given
    const { repo, context } = await fixture()
    const pins = createProjectionPins()
    const { dispatch, repins } = pinnedHandler(repo, context, { pins })
    await dispatch(liveBranch(1))
    await commitAs(repo, "other-session", "system/persona.md", "second")

    // when
    pins.requestRefresh()
    const refreshed = await dispatch(liveBranch(2))

    // then
    expect(refreshed?.systemPrompt).toContain("second")
    expect(repins).toEqual(["refresh"])
  }, 30_000)

  test("#given a persisted pin whose commit no longer exists #when the session resumes #then it repins to HEAD", async () => {
    // given
    const { repo, context } = await fixture()
    const head = await repo.head()
    const vanished: ProjectionPinRecord = {
      version: 1,
      sessionId: SESSION,
      revision: "0123456789abcdef0123456789abcdef01234567",
      noticedThrough: "0123456789abcdef0123456789abcdef01234567",
      compactionId: null,
      pinnedAtMs: 0,
    }
    const { dispatch, repins, records } = pinnedHandler(repo, context)

    // when
    const resumed = await dispatch([...liveBranch(1), pinEntry(vanished)])

    // then
    expect(resumed?.systemPrompt).toContain("first")
    expect(repins).toEqual(["missing-revision"])
    expect(records.at(-1)?.revision).toBe(head)
  }, 30_000)

  test("#given a fork carrying the parent's pin record #when the forked session runs #then it pins fresh at HEAD", async () => {
    // given
    const { repo, context } = await fixture()
    const parent = pinnedHandler(repo, context)
    await parent.dispatch(liveBranch(1))
    await commitAs(repo, "other-session", "system/persona.md", "second")

    // when
    const fork = pinnedHandler(repo, context)
    const forked = await fork.dispatch([...liveBranch(1), pinEntry(parent.records.at(-1))], "session-fork")

    // then
    expect(forked?.systemPrompt).toContain("second")
    expect(fork.repins).toEqual([])
  }, 30_000)

  test("#given only the body of an external file changed #when the next turn runs #then nothing is announced", async () => {
    // given
    const { repo, context } = await fixture()
    await commitAs(repo, "other-session", "reference/a.md", "one")
    const { dispatch } = pinnedHandler(repo, context)
    const first = await dispatch(liveBranch(1))

    // when
    await commitAs(repo, "other-session", "reference/a.md", "two")
    const second = await dispatch(liveBranch(2))

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message).toBeUndefined()
  }, 30_000)

  test("#given pressure advisory enabled #when a large system file lands after the pin #then the pressure line stays as pinned", async () => {
    // given
    const { repo, context } = await fixtureAtSystemTokens(10)
    const { dispatch } = pinnedHandler(repo, context, { resolveCompileWarnTokens: () => 1_000 })
    const first = await dispatch(liveBranch(1))

    // when
    await commitAs(repo, "other-session", "system/human.md", "H".repeat(8_000))
    const second = await dispatch(liveBranch(2))

    // then
    expect(first?.systemPrompt).not.toContain(MEMORY_PRESSURE_METADATA_TOKEN)
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message?.content).toContain("added system/human.md")
  }, 30_000)
})
