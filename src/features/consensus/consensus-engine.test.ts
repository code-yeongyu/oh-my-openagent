const { describe, expect, test } = require("bun:test")

import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { runConsensus } from "./consensus-engine"
import type { ResolvedVoterCandidate, VoterPosition } from "./types"

describe("runConsensus", () => {
  test("#given a GPT caller #when consensus selects voters #then GPT lineage voters are excluded", async () => {
    const spawned: ResolvedVoterCandidate[] = []

    const result = await runConsensus(
      unsafeTestValue<PluginInput>({ client: {} }),
      {
        prompt: "Pick an architecture.",
        callerModel: "openai/gpt-5.5",
        count: 3,
        parentSessionID: "parent",
      },
      undefined,
      {
        getConnectedProviders: async () => ["openai", "anthropic", "google"],
        fetchAvailableModels: async () => new Set([
          "openai/gpt-5.5",
          "anthropic/claude-opus-4-7",
          "google/gemini-3.1-pro",
        ]),
        spawnVoter: async (_ctx, args): Promise<VoterPosition> => {
          spawned.push(args.candidate)
          return createVoterPosition(args.candidate, "position")
        },
      },
    )

    expect(spawned.map(candidate => candidate.lineage)).toEqual(["claude-opus", "gemini-flash"])
    expect(result.advisoryOnly).toBe(false)
  })

  test("#given one empty voter response #when consensus classifies the result #then whitespace is not usable consensus", async () => {
    const result = await runConsensus(
      unsafeTestValue<PluginInput>({ client: {} }),
      {
        prompt: "Interpret test output.",
        count: 2,
        parentSessionID: "parent",
      },
      undefined,
      {
        getConnectedProviders: async () => ["openai", "anthropic"],
        fetchAvailableModels: async () => new Set([
          "openai/gpt-5.5",
          "anthropic/claude-opus-4-7",
        ]),
        spawnVoter: async (_ctx, args): Promise<VoterPosition> => (
          args.candidate.lineage === "gpt"
            ? createVoterPosition(args.candidate, "   ")
            : createVoterPosition(args.candidate, "usable position")
        ),
      },
    )

    expect(result.voters).toHaveLength(2)
    expect(result.advisoryOnly).toBe(true)
  })
})

function createVoterPosition(candidate: ResolvedVoterCandidate, text: string): VoterPosition {
  return {
    lineage: candidate.lineage,
    model: candidate.modelID,
    providerID: candidate.providerID,
    variant: candidate.variant,
    status: "ok",
    text,
    durationMs: 1,
  }
}
