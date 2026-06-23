/// <reference path="../../../bun-test.d.ts" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { rmSync } from "node:fs"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { appendTranscriptEntry, getTranscriptPath } from "../../hooks/claude-code-hooks/transcript"
import { clearChallengeState, recordChallenge } from "../../hooks/reasoning-core-policy-gate/epistemic-interlock-challenge-state"
import { createReasonArgueToolWithDeps } from "./tools"

const metadata = mock(() => {})

const toolContext: ToolContext = {
  sessionID: "ses-test",
  messageID: "msg-test",
  agent: "hephaestus",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata,
  ask: async () => {},
}

function buildProofArtifact(acceptedConclusions: string[]) {
  return {
    theory: {},
    result: {
      semantics: "grounded",
      extensions: [{ index: 0, accepted_conclusions: acceptedConclusions }],
      conclusions: Object.fromEntries(
        acceptedConclusions.map((conclusion) => [
          conclusion,
          {
            conclusion,
            status: "Accepted",
            proof_chain: [
              {
                conclusion,
                from: [],
                rule_id: "d1",
                rule_kind: "defeasible",
              },
            ],
          },
        ]),
      ),
    },
  }
}

function createMockClient(result: unknown) {
  return {
    argue: mock(async () => result),
    evaluate: mock(async () => ({ allow: true })),
    solve: mock(async () => ({
      stop_signal: "Solved",
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async () => ({ count: 0, entries: [] })),
    kbAdd: mock(async () => ({ id: "kb-1" })),
    kbRemove: mock(async () => undefined),
    check: mock(async () => ({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
  }
}

describe("reason_argue KB auto-persist", () => {
  afterEach(() => {
    clearChallengeState("ses-test")
    metadata.mockClear()
    rmSync(getTranscriptPath("ses-test"), { force: true })
  })

  describe("#given an active challenge for the session", () => {
    it("#when the grounded extension accepts allow_action(current) #then it persists a Learned counter-argument insight", async () => {
      recordChallenge("ses-test", "src/foo.ts", "blocked", 1)
      appendTranscriptEntry("ses-test", { type: "tool_use", timestamp: new Date().toISOString(), tool_name: "write", tool_input: { file_path: "src/foo.ts" } })
      const client = createMockClient(buildProofArtifact(["allow_action(current)"]))
      const reasonArgue = createReasonArgueToolWithDeps(undefined, { client })

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

      const kbAddCalls = client.kbAdd.mock.calls as unknown[][]

      expect(client.kbAdd).toHaveBeenCalledTimes(1)
      expect(kbAddCalls[0]?.[0]).toEqual({
        layer: "Learned",
        tags: ["counter-argument", "reason-argue", "file:src/foo.ts"],
        content: {
          Insight: {
            problem_type: "epistemic_interlock_counter_argument",
            lesson: "counter-argument proof src/foo.ts",
            example: "allow_action(current)",
          },
        },
      })
    })
  })

  describe("#given no active challenge for the session", () => {
    it("#when reason_argue succeeds #then it does not persist anything to the KB", async () => {
      const client = createMockClient(buildProofArtifact(["allow_action(current)"]))
      const reasonArgue = createReasonArgueToolWithDeps(undefined, { client })

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

      expect(client.kbAdd).toHaveBeenCalledTimes(0)
    })
  })

  describe("#given an active challenge but no counter-argument conclusion", () => {
    it("#when the grounded extension accepts unrelated conclusions #then it does not persist anything to the KB", async () => {
      recordChallenge("ses-test", "src/foo.ts", "blocked", 1)
      const client = createMockClient(buildProofArtifact(["deny_action(current)"]))
      const reasonArgue = createReasonArgueToolWithDeps(undefined, { client })

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

      expect(client.kbAdd).toHaveBeenCalledTimes(0)
    })
  })
})
