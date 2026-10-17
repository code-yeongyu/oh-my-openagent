import { describe, expect, test } from "bun:test"

import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"
import { AGENT_FALLBACK_CHAINS } from "@oh-my-opencode/senpi-task/agents-builtin"

// senpi-task hand-mirrors the curated agent chains from model-core (it may not depend on that
// package) and its own pin test re-transcribes the same table, so the two tables drifted for weeks
// without any test noticing (#8259). This package depends on both, so it holds the guard: every
// curated agent chain must equal its model-core source rung for rung, except that senpi heads each
// claude-* rung with its Claude subscription lane (#8051) and ranks `chatgpt-subscription` ahead of the
// `openai` lane on GPT rungs (#8300, #8734; model-core lists `openai` first, OpenCode's single OpenAI id).

const CURATED_AGENT_MIRROR_SOURCES = {
  explore: "explore",
  librarian: "librarian",
  "plan-consultant": "metis",
  "plan-reviewer": "momus",
} as const

const SENPI_CLAUDE_LANE = "anthropic-subscription"
const OPENAI_API_LANE = "openai"
const CHATGPT_SUBSCRIPTION_LANE = "chatgpt-subscription"
// senpi's Kimi Code registry id is `kimi-coding`; model-core carries the models.dev/opencode id
// `kimi-for-coding` only, so a senpi kimi rung heads with the extra id (same shape as the category
// chains). Drop it before comparing.
const SENPI_KIMI_LANE = "kimi-coding"

function withoutSenpiClaudeLane(entry: DelegateFallbackEntry): DelegateFallbackEntry {
  if (!entry.model.startsWith("claude-")) return entry
  const [lane, ...mirroredProviders] = entry.providers
  expect(lane, `${entry.model} rung must head with ${SENPI_CLAUDE_LANE}`).toBe(SENPI_CLAUDE_LANE)
  return { ...entry, providers: mirroredProviders }
}

// model-core's GPT rungs read `openai, chatgpt-subscription, ...`; senpi's read
// `chatgpt-subscription, openai, ...`. Move the subscription lane in front of the API lane.
function withSubscriptionLaneFirst(entry: DelegateFallbackEntry): DelegateFallbackEntry {
  if (!entry.providers.includes(OPENAI_API_LANE) || !entry.providers.includes(CHATGPT_SUBSCRIPTION_LANE)) return entry
  const rest = entry.providers.filter((provider) => provider !== CHATGPT_SUBSCRIPTION_LANE)
  const apiLane = rest.indexOf(OPENAI_API_LANE)
  return { ...entry, providers: [...rest.slice(0, apiLane), CHATGPT_SUBSCRIPTION_LANE, ...rest.slice(apiLane)] }
}

function withoutSenpiKimiLane(entry: DelegateFallbackEntry): DelegateFallbackEntry {
  if (!entry.providers.includes(SENPI_KIMI_LANE)) return entry
  return { ...entry, providers: entry.providers.filter((provider) => provider !== SENPI_KIMI_LANE) }
}

describe("builtin curated agent chain parity", () => {
  for (const [senpiName, modelCoreName] of Object.entries(CURATED_AGENT_MIRROR_SOURCES)) {
    test(`#given the senpi ${senpiName} chain #when compared with model-core ${modelCoreName} #then every rung matches modulo the ${SENPI_CLAUDE_LANE} head and the ${CHATGPT_SUBSCRIPTION_LANE}-before-${OPENAI_API_LANE} order`, () => {
      const senpiChain = AGENT_FALLBACK_CHAINS[senpiName]
      const mirrorSource = AGENT_MODEL_REQUIREMENTS[modelCoreName]?.fallbackChain

      expect(senpiChain).toBeDefined()
      expect(mirrorSource).toBeDefined()
      expect(senpiChain?.map(withoutSenpiClaudeLane).map(withoutSenpiKimiLane)).toEqual(
        (mirrorSource ?? []).map(withSubscriptionLaneFirst),
      )
    })
  }
})
