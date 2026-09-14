import { describe, expect, test } from "bun:test"

import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"
import { AGENT_FALLBACK_CHAINS } from "@oh-my-opencode/senpi-task/agents-builtin"

// senpi-task hand-mirrors the curated agent chains from model-core (it may not depend on that
// package) and its own pin test re-transcribes the same table, so the two tables drifted for weeks
// without any test noticing (#8259). This package depends on both, so it holds the guard: every
// curated agent chain must equal its model-core source rung for rung, except that senpi heads each
// claude-* rung with its Claude subscription lane (#8051).

const CURATED_AGENT_MIRROR_SOURCES = {
  explore: "explore",
  librarian: "librarian",
  "plan-consultant": "metis",
  "plan-reviewer": "momus",
} as const

const SENPI_CLAUDE_LANE = "claude-sdk-oauth"

function withoutSenpiClaudeLane(entry: DelegateFallbackEntry): DelegateFallbackEntry {
  if (!entry.model.startsWith("claude-")) return entry
  const [lane, ...mirroredProviders] = entry.providers
  expect(lane, `${entry.model} rung must head with ${SENPI_CLAUDE_LANE}`).toBe(SENPI_CLAUDE_LANE)
  return { ...entry, providers: mirroredProviders }
}

describe("builtin curated agent chain parity", () => {
  for (const [senpiName, modelCoreName] of Object.entries(CURATED_AGENT_MIRROR_SOURCES)) {
    test(`#given the senpi ${senpiName} chain #when compared with model-core ${modelCoreName} #then every rung matches modulo the ${SENPI_CLAUDE_LANE} head`, () => {
      const senpiChain = AGENT_FALLBACK_CHAINS[senpiName]
      const mirrorSource = AGENT_MODEL_REQUIREMENTS[modelCoreName]?.fallbackChain

      expect(senpiChain).toBeDefined()
      expect(mirrorSource).toBeDefined()
      expect(senpiChain?.map(withoutSenpiClaudeLane)).toEqual(mirrorSource ?? [])
    })
  }
})
