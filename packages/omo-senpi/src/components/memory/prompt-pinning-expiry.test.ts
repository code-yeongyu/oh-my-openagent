import { describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { MemoryBlockCache, type GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { MemoryIdentityContext } from "./context"
import { createMemoryPromptHandler } from "./prompt"
import { IDENTITY, beforeAgentStart, dispatchEvent, eventContext, fixture, liveBranch } from "./prompt.test-support"
import {
  MEMORY_EXPIRED_METADATA_TOKEN,
  PROJECTION_PIN_ENTRY_TYPE,
  createProjectionPins,
  type ProjectionPinRecord,
} from "./projection-pin"

const SESSION = "session-1"
const EXPIRES_AT = Date.UTC(2026, 9, 27, 6, 33)
const OUTAGE = "provider X is down"

async function commitExpiring(repo: GitMemoryRepo): Promise<void> {
  await writeFile(join(repo.dir, "system/outage.md"), `---\ndescription: Outage\nexpires: 2026-10-27T06:33Z\n---\n${OUTAGE}\n`)
  await repo.commitWrite(["system/outage.md"], "record outage", { agentId: IDENTITY, authorName: "Prompt Agent" })
}

function clockedHandler(repo: GitMemoryRepo, context: MemoryIdentityContext, clock: { now: number }) {
  const records: ProjectionPinRecord[] = []
  const pi = new FakeExtensionAPI()
  pi.on("before_agent_start", createMemoryPromptHandler({
    resolveContext: () => context,
    createRepo: () => repo,
    cache: new MemoryBlockCache({ now: () => clock.now }),
    pins: createProjectionPins({ now: () => clock.now }),
    recordPin: (record) => records.push(record),
  }))
  const dispatch = (branch: readonly unknown[], sessionId = SESSION) =>
    dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext(sessionId, branch))
  return { dispatch, records }
}

function withPin(branch: readonly unknown[], record: ProjectionPinRecord | undefined): readonly unknown[] {
  return [...branch, { type: "custom", id: "pin-entry", customType: PROJECTION_PIN_ENTRY_TYPE, data: record }]
}

describe("session-pinned memory projection and expiry", () => {
  test("#given a session pinned before a block expires #when turns run after the instant #then the prompt keeps its bytes and the expiry is announced once", async () => {
    // given
    const { repo, context } = await fixture()
    await commitExpiring(repo)
    const clock = { now: EXPIRES_AT - 1 }
    const { dispatch } = clockedHandler(repo, context, clock)
    const first = await dispatch(liveBranch(1))

    // when
    clock.now = EXPIRES_AT + 1
    const second = await dispatch(liveBranch(2))
    const third = await dispatch(liveBranch(3))

    // then
    expect(first?.systemPrompt).toContain(OUTAGE)
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(third?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message?.content).toContain(MEMORY_EXPIRED_METADATA_TOKEN)
    expect(second?.message?.content).toContain("system/outage.md")
    expect(third?.message).toBeUndefined()
  }, 30_000)

  test("#given a block that expired before a session starts #when its first turn runs #then the block is not projected and nothing is announced", async () => {
    // given
    const { repo, context } = await fixture()
    await commitExpiring(repo)
    const { dispatch } = clockedHandler(repo, context, { now: EXPIRES_AT })

    // when
    const first = await dispatch(liveBranch(1))

    // then
    expect(first?.systemPrompt).not.toContain(OUTAGE)
    expect(first?.systemPrompt).not.toContain("system/outage.md")
    expect(first?.message).toBeUndefined()
  }, 30_000)

  test("#given a pinned session that already announced an expiry #when a new process resumes it later #then it reproduces the pinned bytes and does not announce again", async () => {
    // given
    const { repo, context } = await fixture()
    await commitExpiring(repo)
    const clock = { now: EXPIRES_AT - 1 }
    const original = clockedHandler(repo, context, clock)
    const first = await original.dispatch(liveBranch(1))
    clock.now = EXPIRES_AT + 1
    await original.dispatch(liveBranch(2))

    // when
    const resumedClock = { now: EXPIRES_AT + 60_000 }
    const resumed = clockedHandler(repo, context, resumedClock)
    const turn = await resumed.dispatch(withPin(liveBranch(3), original.records.at(-1)))

    // then
    expect(turn?.systemPrompt).toBe(first?.systemPrompt)
    expect(turn?.message).toBeUndefined()
  }, 30_000)
})
