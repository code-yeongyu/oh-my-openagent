/// <reference path="../../../../../bun-test.d.ts" />

import { afterEach, describe, expect, it } from "bun:test"
import { setCompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"
import {
  recordLoadedSkill,
} from "../../shared/session-loaded-skills"
import {
  releaseAllPromptAsyncReservationsForTesting,
} from "../shared/prompt-async-gate"
import { createCompactionContextInjector } from "./index"

type SessionMessageResponse = Array<{
  info?: Record<string, unknown>
}>

type PromptAsyncInput = {
  path: { id: string }
  body: {
    noReply?: boolean
    agent?: string
    model?: { providerID: string; modelID: string }
    tools?: Record<string, boolean>
    parts: Array<{
      type: "text"
      text: string
      synthetic?: true
      metadata?: { compaction_continue?: true }
    }>
  }
  query?: { directory: string }
}

function createPromptAsyncRecorder(): {
  calls: PromptAsyncInput[]
  promptAsync: (input: PromptAsyncInput) => Promise<Record<string, never>>
} {
  const calls: PromptAsyncInput[] = []

  return {
    calls,
    promptAsync: async (input: PromptAsyncInput) => {
      calls.push(input)
      return {}
    },
  }
}

function createMockContext(
  messageResponses: SessionMessageResponse[],
  promptAsync: (input: PromptAsyncInput) => Promise<Record<string, never>>,
) {
  let callIndex = 0

  return {
    client: {
      session: {
        messages: async () => {
          const response =
            messageResponses[Math.min(callIndex, messageResponses.length - 1)] ?? []
          callIndex += 1
          return { data: response }
        },
        promptAsync,
      },
    },
    directory: "/tmp/test",
  }
}

describe("createCompactionContextInjector skill re-injection", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  it("#given a skill body was loaded via the skill tool before compaction #when compaction fires #then the recovery prompt carries the skill body", async () => {
    // given
    const sessionID = "ses_skill_reinjection_capture"
    const promptAsyncRecorder = createPromptAsyncRecorder()
    const checkpointedPromptConfig = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: true },
        },
      },
    ]
    const incompletePromptConfig = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      },
    ]
    const ctx = createMockContext(
      [
        checkpointedPromptConfig,
        incompletePromptConfig,
        incompletePromptConfig,
        checkpointedPromptConfig,
      ],
      promptAsyncRecorder.promptAsync,
    )
    recordLoadedSkill(sessionID, "team-ops", "close teams with team_list then team_delete, never read loops")
    const injector = createCompactionContextInjector({ ctx })

    // when
    await injector.capture(sessionID)
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })

    // then
    expect(promptAsyncRecorder.calls.length).toBe(1)
    const recoveryPart = promptAsyncRecorder.calls[0]?.body.parts[0]
    expect(recoveryPart?.synthetic).toBe(true)
    expect(recoveryPart?.text).toContain("team-ops")
    expect(recoveryPart?.text).toContain(
      "close teams with team_list then team_delete, never read loops",
    )
  })

  it("#given the agent config already matches but skills were checkpointed #when compaction fires #then recovery still dispatches to restore skill bodies", async () => {
    // given
    const sessionID = "ses_skill_reinjection_gate_bypass"
    const promptAsyncRecorder = createPromptAsyncRecorder()
    setCompactionAgentConfigCheckpoint(sessionID, {
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5" },
      tools: { bash: true },
      skills: [
        { name: "git-master", body: "atomic commits only, rebase before push" },
      ],
    })
    const recoveredPromptConfig = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: true },
        },
      },
    ]
    const ctx = createMockContext(
      [recoveredPromptConfig],
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })

    // when
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })

    // then
    expect(promptAsyncRecorder.calls.length).toBe(1)
    const recoveryPart = promptAsyncRecorder.calls[0]?.body.parts[0]
    expect(recoveryPart?.text).toContain("git-master")
    expect(recoveryPart?.text).toContain("atomic commits only, rebase before push")
  })

  it("#given no skills were loaded #when compaction recovery runs #then behavior is unchanged and no skill block is added", async () => {
    // given
    const sessionID = "ses_skill_reinjection_absent"
    const promptAsyncRecorder = createPromptAsyncRecorder()
    setCompactionAgentConfigCheckpoint(sessionID, {
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5" },
      tools: { bash: true },
    })
    const recoveredPromptConfig = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: true },
        },
      },
    ]
    const ctx = createMockContext(
      [recoveredPromptConfig],
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })

    // when
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })

    // then
    expect(promptAsyncRecorder.calls.length).toBe(0)
  })
})
