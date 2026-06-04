const { describe, expect, test } = require("bun:test")

import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import type { ConsensusInput, ConsensusResult } from "../../features/consensus"
import { createConsensusTool } from "./tool"

describe("createConsensusTool", () => {
  test("#given a subagent session #when consensus executes #then the call is rejected", async () => {
    const consensusTool = createConsensusTool(
      createPluginInput("/workspace"),
      undefined,
      {
        isSubagentSession: () => true,
        runConsensus: async () => createConsensusResult([]),
      },
    )

    const result = await consensusTool.execute(
      { prompt: "Should I ask the user?" },
      createToolContext("/workspace"),
    )

    expect(result).toContain("restricted to the main agent")
  })

  test("#given a parent session directory #when consensus runs #then it is forwarded to the engine", async () => {
    let capturedInput: ConsensusInput | undefined
    const consensusTool = createConsensusTool(
      createPluginInput("/fallback-workspace", "/parent-workspace"),
      undefined,
      {
        isSubagentSession: () => false,
        runConsensus: async (_ctx, input) => {
          capturedInput = input
          return createConsensusResult([
            {
              lineage: "gpt",
              model: "gpt-5.5",
              providerID: "openai",
              variant: undefined,
              status: "ok",
              text: "position",
              durationMs: 1,
            },
          ])
        },
      },
    )

    await consensusTool.execute(
      { prompt: "Should this use the repo cwd?" },
      createToolContext("/tool-context-workspace"),
    )

    expect(capturedInput?.parentDirectory).toBe("/parent-workspace")
  })

  test("#given an empty voter response #when consensus returns #then the tool reports no usable consensus signal", async () => {
    const consensusTool = createConsensusTool(
      createPluginInput("/workspace"),
      undefined,
      {
        isSubagentSession: () => false,
        runConsensus: async () => createConsensusResult([
          {
            lineage: "gpt",
            model: "gpt-5.5",
            providerID: "openai",
            variant: undefined,
            status: "ok",
            text: " ",
            durationMs: 1,
          },
        ]),
      },
    )

    const result = await consensusTool.execute(
      { prompt: "Interpret this test output." },
      createToolContext("/workspace"),
    )
    const parsed = JSON.parse(String(result)) as { ok: boolean; advisoryOnly: boolean; guidanceForSynthesizer: string }

    expect(parsed.ok).toBe(false)
    expect(parsed.advisoryOnly).toBe(true)
    expect(parsed.guidanceForSynthesizer).toContain("No voters returned a usable position")
  })
})

function createPluginInput(directory: string, parentDirectory = directory): PluginInput {
  return unsafeTestValue<PluginInput>({
    directory,
    client: {
      session: {
        get: async () => ({ data: { directory: parentDirectory } }),
      },
    },
  })
}

function createToolContext(directory: string): ToolContext {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "sisyphus",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

function createConsensusResult(voters: ConsensusResult["voters"]): ConsensusResult {
  return {
    triggerType: "explicit",
    callerModel: undefined,
    callerLineage: undefined,
    voters,
    advisoryOnly: voters.filter(voter => voter.status === "ok" && voter.text.trim().length > 0).length < 2,
    startedAt: "2026-06-04T00:00:00.000Z",
    finishedAt: "2026-06-04T00:00:00.000Z",
    totalDurationMs: 1,
  }
}
