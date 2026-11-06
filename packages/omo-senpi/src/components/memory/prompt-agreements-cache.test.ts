import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { AGREEMENTS_PATH, MemoryBlockCache, agreementId, type GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { AGREEMENT_FLAGGED_ENTRY_TYPE } from "./agreement-notice"
import { memorySettings } from "./memory.test-support"
import { createProjectionPins } from "./projection-pin"
import { MEMORY_AGREEMENT_METADATA_TOKEN, createMemoryPromptHandler } from "./prompt"
import { beforeAgentStart, dispatchEvent, eventContext, fixture, liveBranch } from "./prompt.test-support"
import { createMemoryNoticeInputs } from "./wiring-notice-inputs"

const SESSION = "session-1"
const TEXT = "Never filter the message monitor output"
const ID = agreementId(TEXT)

async function commitLedger(repo: GitMemoryRepo, n: number, status: string): Promise<void> {
  await mkdir(join(repo.dir, "system"), { recursive: true })
  await writeFile(
    join(repo.dir, AGREEMENTS_PATH),
    `---\ndescription: Agreements\n---\n\n- [global] ${TEXT} <!-- id: ${ID}; by: agent; n: ${n}; status: ${status} -->\n`,
  )
  await repo.commitWrite([AGREEMENTS_PATH], "chore(facts): extract 1 fact\n\nGenerated-By: facts-extractor", {
    agentId: "prompt-agent", authorName: "Facts Extractor",
  })
}

describe("agreements and the cached prompt prefix (prompt-cache contract)", () => {
  test("#given a pinned session #when a facts commit flags an agreement between turns #then the system prompt keeps its bytes, the flag arrives once as a notice and a person-facing entry, and the new count enters the prompt only after a refresh", async () => {
    // given
    const { repo, context } = await fixture()
    await commitLedger(repo, 2, "active")
    const pins = createProjectionPins()
    const entries: { readonly customType: string; readonly data: unknown }[] = []
    const inputs = createMemoryNoticeInputs({
      resolveContext: () => context,
      loadSettings: () => memorySettings(),
      appendEntry: (customType, data) => entries.push({ customType, data }),
    })
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context, createRepo: () => repo, cache: new MemoryBlockCache(), pins, ...inputs,
    }))
    const turn = (count: number) => dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext(SESSION, liveBranch(count)))
    const first = await turn(1)

    // when
    await commitLedger(repo, 3, "needs-human")
    const second = await turn(2)
    const third = await turn(3)
    pins.requestRefresh()
    const refreshed = await turn(4)

    // then
    expect(first?.systemPrompt).toContain("[broken x2]")
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(third?.systemPrompt).toBe(first?.systemPrompt)
    expect(second?.message?.content).toContain(`updated ${AGREEMENTS_PATH}`)
    expect(second?.message?.content).toContain(MEMORY_AGREEMENT_METADATA_TOKEN)
    expect(third?.message).toBeUndefined()
    expect(entries).toEqual([{ customType: AGREEMENT_FLAGGED_ENTRY_TYPE, data: { id: ID, text: TEXT, n: 3, by: "agent" } }])
    expect(refreshed?.systemPrompt).toContain(`[broken x3] NEEDS-HUMAN: ${TEXT}`)
  }, 30_000)
})
