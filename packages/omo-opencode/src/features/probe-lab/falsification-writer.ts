import {
  createReasoningCoreClient,
  type ReasoningCoreClient,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import { log } from "../../shared"
import type { Hypothesis } from "./types"

const KB_TAG_ROOT = "probe-lab"
const KB_TAG_FALSIFICATION = "falsification"
const KB_TAG_CONFIRMATION = "confirmation"

let cachedClient: ReasoningCoreClient | null = null

function getClient(): ReasoningCoreClient {
  if (cachedClient == null) {
    cachedClient = createReasoningCoreClient()
  }
  return cachedClient
}

export function __setReasoningCoreClientForTest(client: ReasoningCoreClient | null): void {
  cachedClient = client
}

export type FalsificationOutcome = {
  kb_entry_id: string | null
  error: string | null
}

function reasoningTag(reasoning: string | null | undefined): string | null {
  if (!reasoning) return null
  const trimmed = reasoning.trim()
  if (!trimmed) return null
  let hash = 0
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) | 0
  }
  return `reasoning-hash:${(hash >>> 0).toString(16)}`
}

async function writePremise(args: {
  formula: string
  hypothesisId: string
  evidenceId: number
  reasoning: string | null | undefined
  kind: "falsification" | "confirmation"
  errorTag: string
}): Promise<FalsificationOutcome> {
  try {
    const client = getClient()
    const tags = [
      KB_TAG_ROOT,
      args.kind === "falsification" ? KB_TAG_FALSIFICATION : KB_TAG_CONFIRMATION,
      `hypothesis:${args.hypothesisId}`,
      `evidence:${args.evidenceId}`,
    ]
    const reasoningHashTag = reasoningTag(args.reasoning)
    if (reasoningHashTag) tags.push(reasoningHashTag)
    const result = await client.kbAdd({
      layer: "Learned",
      content: { Premise: { formula: args.formula } },
      tags,
    })
    return { kb_entry_id: result.id, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`[probe-lab] ${args.errorTag} KB write failed (non-blocking)`, {
      hypothesis_id: args.hypothesisId,
      error: message,
    })
    return { kb_entry_id: null, error: message }
  }
}

export async function recordRefutation(args: {
  hypothesis: Hypothesis
  evidenceId: number
  reasoning?: string | null
}): Promise<FalsificationOutcome> {
  return writePremise({
    formula: `refuted(hypothesis(${JSON.stringify(args.hypothesis.id)}, ${JSON.stringify(args.hypothesis.text)}))`,
    hypothesisId: args.hypothesis.id,
    evidenceId: args.evidenceId,
    reasoning: args.reasoning,
    kind: "falsification",
    errorTag: "falsification",
  })
}

export async function recordConfirmation(args: {
  hypothesis: Hypothesis
  evidenceId: number
  reasoning?: string | null
}): Promise<FalsificationOutcome> {
  return writePremise({
    formula: `confirmed(hypothesis(${JSON.stringify(args.hypothesis.id)}, ${JSON.stringify(args.hypothesis.text)}))`,
    hypothesisId: args.hypothesis.id,
    evidenceId: args.evidenceId,
    reasoning: args.reasoning,
    kind: "confirmation",
    errorTag: "confirmation",
  })
}
