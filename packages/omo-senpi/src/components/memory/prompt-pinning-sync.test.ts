import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { MemoryBlockCache, type GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { MemoryIdentityContext } from "./context"
import { MEMORY_CHANGES_METADATA_TOKEN, createProjectionPins } from "./projection-pin"
import { createMemoryPromptHandler } from "./prompt"
import { IDENTITY, beforeAgentStart, dispatchEvent, eventContext, fixture, liveBranch } from "./prompt.test-support"

const SESSION = "session-1"
const DEVICES: Readonly<Record<string, string>> = { "device:dev-mini": "Mac mini" }

async function write(repo: GitMemoryRepo, path: string, body: string): Promise<void> {
  await mkdir(dirname(join(repo.dir, path)), { recursive: true })
  await writeFile(join(repo.dir, path), `---\ndescription: ${path}\n---\n${body}\n`)
}

/** A commit shaped like the sync engine's: authored OmO Sync, with its seq and principal trailers. */
async function syncCommit(repo: GitMemoryRepo, path: string, body: string, principals: string): Promise<void> {
  await write(repo, path, body)
  await repo.commitWrite([path], `sync: 1 memories updated\n\nSync-Seq: 4-4\nSync-Principals: ${principals}`, {
    agentId: IDENTITY,
    authorName: "OmO Sync",
  })
}

async function otherSessionCommit(repo: GitMemoryRepo, path: string, body: string): Promise<void> {
  await write(repo, path, body)
  await repo.commitWrite([path], `record ${path}\n\nOmo-Writer: memory-tool\nOmo-Session: other\nOmo-Turn: 1`, {
    agentId: IDENTITY,
    authorName: "Prompt Agent",
  })
}

function handler(repo: GitMemoryRepo, context: MemoryIdentityContext) {
  const pi = new FakeExtensionAPI()
  pi.on("before_agent_start", createMemoryPromptHandler({
    resolveContext: () => context,
    createRepo: () => repo,
    cache: new MemoryBlockCache(),
    pins: createProjectionPins({ deviceName: (principal) => DEVICES[principal] }),
    recordPin: () => undefined,
  }))
  return (turn: number) => dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext(SESSION, liveBranch(turn)))
}

describe("synced commits reach a pinned session through the existing notice", () => {
  test("#given a pinned session #when a sync commit from another device lands #then the next turn's notice names that device and the prompt keeps its bytes", async () => {
    // given
    const { repo, context } = await fixture()
    const dispatch = handler(repo, context)
    const first = await dispatch(1)

    // when
    await syncCommit(repo, "system/persona.md", "written on the mini", "device:dev-mini")
    const second = await dispatch(2)

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message?.content).toContain(MEMORY_CHANGES_METADATA_TOKEN)
    expect(second?.message?.content).toContain("updated system/persona.md")
    expect(second?.message?.content).toContain("synced from Mac mini")
  }, 30_000)

  test("#given a sync commit from a principal this device does not know #when the next turn runs #then the notice says another device", async () => {
    // given
    const { repo, context } = await fixture()
    const dispatch = handler(repo, context)
    await dispatch(1)

    // when
    await syncCommit(repo, "reference/new.md", "from somewhere", "device:dev-unknown")
    const second = await dispatch(2)

    // then
    expect(second?.message?.content).toContain("added reference/new.md")
    expect(second?.message?.content).toContain("synced from another device")
  }, 30_000)

  test("#given a reference-only sync commit that edits an existing body #when the next turn runs #then neither the system block nor the notice changes", async () => {
    // given
    const { repo, context } = await fixture()
    const dispatch = handler(repo, context)
    await otherSessionCommit(repo, "reference/notes.md", "before")
    const first = await dispatch(1)

    // when
    await syncCommit(repo, "reference/notes.md", "after", "device:dev-mini")
    const second = await dispatch(2)

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message).toBeUndefined()
  }, 30_000)

  test("#given a change written by another local session #when the next turn runs #then the notice names no synced source", async () => {
    // given
    const { repo, context } = await fixture()
    const dispatch = handler(repo, context)
    await dispatch(1)

    // when
    await otherSessionCommit(repo, "reference/local.md", "local")
    const second = await dispatch(2)

    // then
    expect(second?.message?.content).toContain("added reference/local.md")
    expect(second?.message?.content).not.toContain("synced from")
  }, 30_000)
})
