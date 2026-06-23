/// <reference path="./bun-test.d.ts" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { rmSync } from "node:fs"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { appendTranscriptEntry, getTranscriptPath } from "../../hooks/claude-code-hooks/transcript"
import { createReasonArgueToolWithDeps } from "../../tools/reasoning-core/tools"
import { clearChallengeState, evaluateEpistemicInterlockGate } from "./epistemic-interlock-gate"
import type { ReasoningCoreClient, ReasoningCoreKbAddEntry } from "./reasoning-core-client"
import type { CandidateAction } from "./types"

const toolContext: ToolContext = {
  sessionID: "session-hephaestus",
  messageID: "msg-hephaestus",
  agent: "hephaestus",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: mock(() => {}),
  ask: async () => {},
}

function createCandidate(): CandidateAction {
  return {
    tool: "write",
    sessionID: "session-hephaestus",
    agent: "hephaestus",
    args: { file_path: "src/foo.ts" },
  }
}

function buildProofArtifact() {
  return {
    theory: {},
    result: {
      semantics: "grounded",
      extensions: [{ index: 0, accepted_conclusions: ["allow_action(current)"] }],
      conclusions: {
        "allow_action(current)": {
          conclusion: "allow_action(current)",
          status: "Accepted",
          proof_chain: [
            {
              conclusion: "allow_action(current)",
              from: [],
              rule_id: "d1",
              rule_kind: "defeasible",
            },
          ],
        },
      },
    },
  }
}

function createMockClient(): ReasoningCoreClient {
  const constraintEntries = [{ tags: ["constraint:architecture"], content: { Insight: { lesson: "No direct mutation" } } }]
  const counterEntries: Array<Record<string, unknown>> = []
  let evaluateCalls = 0

  return {
    argue: mock(async () => buildProofArtifact()),
    evaluate: mock(async () => {
      if (evaluateCalls === 0) {
        evaluateCalls += 1
        return { allow: false, reason: "constraint violated" }
      }

      return { allow: true }
    }),
    solve: mock(async () => ({
      stop_signal: "Solved",
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async (query: { similarity_query: string }) => {
      if (query.similarity_query === "counter-argument proof src/foo.ts") {
        return { count: counterEntries.length === 0 ? 0 : counterEntries.length + 1, entries: counterEntries }
      }

      return { count: constraintEntries.length, entries: constraintEntries }
    }),
    kbAdd: mock(async (entry: ReasoningCoreKbAddEntry) => {
      counterEntries.push({ layer: entry.layer, content: entry.content, tags: entry.tags })
      return { id: "kb-proof-1" }
    }),
    kbRemove: mock(async () => undefined),
    check: mock(async () => ({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
  }
}

describe("epistemic-interlock counter-argument flow", () => {
  afterEach(() => {
    clearChallengeState("session-hephaestus")
    rmSync(getTranscriptPath("session-hephaestus"), { force: true })
  })

  describe("#given a non-Prometheus agent challenged by a KB constraint", () => {
    it("#when the agent argues and retries #then the second write is allowed", async () => {
      const client = createMockClient()
      const candidate = createCandidate()
      const reasonArgue = createReasonArgueToolWithDeps(undefined, { client })
      appendTranscriptEntry("session-hephaestus", { type: "tool_use", timestamp: new Date().toISOString(), tool_name: "write", tool_input: { file_path: "src/foo.ts" } })

      const firstVerdict = await evaluateEpistemicInterlockGate({ client, candidate })
      expect(firstVerdict.allow).toBe(false)

      await reasonArgue.execute(
        {
          theory: {
            premises: [{ formula: "mutation_proposed(current)" }],
            classical_negation: true,
          },
          semantics: "grounded",
        },
        toolContext,
      )

      const retryVerdict = await evaluateEpistemicInterlockGate({ client, candidate })
      expect(retryVerdict).toEqual({ allow: true })
    })

    it("#when the gate blocks the first write #then the message explains auto-persist to the Learned KB", async () => {
      const client = createMockClient()
      const verdict = await evaluateEpistemicInterlockGate({ client, candidate: createCandidate() })

      expect(verdict.reason?.includes("automatically persisted to the Learned KB")).toBe(true)
    })
  })
})
