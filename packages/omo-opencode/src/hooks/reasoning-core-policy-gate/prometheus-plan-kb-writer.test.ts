import { describe, expect, it, mock } from "bun:test"
import { writeAllowedPlanPattern } from "./prometheus-plan-kb-writer"
import type { ReasoningCoreClient } from "./reasoning-core-client"
import type { PolicyVerdict } from "./types"

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock(() => Promise.resolve({ stop_signal: "Solved", constraint_state: { domains: {}, solved: true, solved_count: 0, total_count: 0 }, iterations_used: 0, reasoning_trace: [], argumentation_result: undefined })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(() => Promise.resolve({ count: 0, entries: [] })),
    kbAdd: mock(() => Promise.resolve({ id: "kb_test_123" })),
    kbRemove: mock(() => Promise.resolve()),
    check: mock(() => Promise.resolve({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(() => Promise.resolve({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  } as ReasoningCoreClient
}

describe("Prometheus plan KB writer", () => {
  describe("#given a successful plan-write gate ALLOW verdict", () => {
    it("#when prerequisites are satisfied #then writes an Insight to KB Learned layer", async () => {
      //#given
      const kbAddMock = mock(() => Promise.resolve({ id: "kb_new_1" }))
      const client = createMockClient({ kbAdd: kbAddMock })

      const verdict: PolicyVerdict = {
        allow: true,
        proofArtifact: {
          kbResult: { count: 3, entries: [] },
          planningStatus: { session_active: true, domains: {}, is_solved: false, reasoning_history: [] },
          outcome: {
            stop_signal: "Solved",
            constraint_state: {
              domains: {
                research_completed: [1],
                user_intent_clear: [1],
                scope_bounded: [1],
                codebase_explored: [1],
                no_blocking_questions: [1],
                dependencies_identified: [1],
              },
              solved: true,
              solved_count: 6,
              total_count: 6,
            },
            iterations_used: 1,
          },
        },
      }

      //#when
      await writeAllowedPlanPattern({ client, verdict, planName: "auth-refactor", sessionID: "ses-test-1" })

      //#then
      expect(kbAddMock).toHaveBeenCalledTimes(1)
      const call = kbAddMock.mock.calls[0][0]
      expect(call.layer).toBe("Learned")
      expect(call.tags).toContain("prometheus-plan-generation")
      expect(call.tags).toContain("planning")
      expect(call.tags).toContain("plan:auth-refactor")
      expect(call.content.Insight.problem_type).toBe("prometheus_plan_generation")
      expect(call.content.Insight.lesson).toContain("auth-refactor")
      expect(call.content.Insight.lesson).toContain("research_completed")
      expect(call.content.Insight.example).toContain("auth-refactor")
    })

    it("#when an exact duplicate already exists #then removes it before writing the new pattern", async () => {
      const kbRemoveMock = mock(() => Promise.resolve())
      const kbAddMock = mock(() => Promise.resolve({ id: "kb_new_2" }))
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({
          count: 1,
          entries: [{
            id: "kb_old_1",
            tags: ["prometheus-plan-generation", "planning", "plan:auth-refactor"],
            content: {
              Insight: {
                problem_type: "prometheus_plan_generation",
                lesson: `Plan "auth-refactor" passed all six prerequisites (research_completed, user_intent_clear, scope_bounded, codebase_explored, no_blocking_questions, dependencies_identified) with stop_signal=Solved and 0 prior KB patterns consulted.`,
                example: `session plan-write gate: plan="auth-refactor", domains={research_completed=[1]}, solved=true`,
              },
            },
          }],
        })),
        kbRemove: kbRemoveMock,
        kbAdd: kbAddMock,
      })

      const verdict: PolicyVerdict = {
        allow: true,
        proofArtifact: {
          kbResult: { count: 0, entries: [] },
          planningStatus: { session_active: true, domains: {}, is_solved: false, reasoning_history: [] },
          outcome: {
            stop_signal: "Solved",
            constraint_state: { domains: { research_completed: [1] }, solved: true, solved_count: 6, total_count: 6 },
            iterations_used: 1,
          },
        },
      }

      await writeAllowedPlanPattern({ client, verdict, planName: "auth-refactor", sessionID: "ses-test-replace" })

      expect(kbRemoveMock).toHaveBeenCalledWith({ id: "kb_old_1" })
      expect(kbAddMock).toHaveBeenCalledTimes(1)
      expect(kbRemoveMock.mock.invocationCallOrder[0]).toBeLessThan(kbAddMock.mock.invocationCallOrder[0])
    })

    it("#when the match is ambiguous #then keeps both patterns and skips removal", async () => {
      const kbRemoveMock = mock(() => Promise.resolve())
      const kbAddMock = mock(() => Promise.resolve({ id: "kb_new_3" }))
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({
          count: 1,
          entries: [{
            id: "kb_old_2",
            tags: ["prometheus-plan-generation", "planning", "plan:another-plan"],
            content: { Insight: { problem_type: "prometheus_plan_generation", lesson: "Different lesson", example: "Different example" } },
          }],
        })),
        kbRemove: kbRemoveMock,
        kbAdd: kbAddMock,
      })

      const verdict: PolicyVerdict = {
        allow: true,
        proofArtifact: {
          kbResult: { count: 0, entries: [] },
          planningStatus: { session_active: true, domains: {}, is_solved: false, reasoning_history: [] },
          outcome: {
            stop_signal: "Solved",
            constraint_state: { domains: { research_completed: [1] }, solved: true, solved_count: 6, total_count: 6 },
            iterations_used: 1,
          },
        },
      }

      await writeAllowedPlanPattern({ client, verdict, planName: "auth-refactor", sessionID: "ses-test-ambiguous" })

      expect(kbRemoveMock).not.toHaveBeenCalled()
      expect(kbAddMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given a fallback ALLOW verdict", () => {
    it("#when proofArtifact has fallbackAllow #then skips KB write", async () => {
      //#given
      const kbAddMock = mock(() => Promise.resolve({ id: "kb_skip" }))
      const client = createMockClient({ kbAdd: kbAddMock })

      const verdict: PolicyVerdict = {
        allow: true,
        proofArtifact: { fallbackAllow: true, reason: "reasoning-core unavailable" },
      }

      //#when
      await writeAllowedPlanPattern({ client, verdict, planName: "skip-plan", sessionID: "ses-test-2" })

      //#then
      expect(kbAddMock).toHaveBeenCalledTimes(0)
    })
  })

  describe("#given a KB write failure", () => {
    it("#when kbAdd throws #then does not propagate the error", async () => {
      //#given
      const kbAddMock = mock(() => Promise.reject(new Error("KB write failed: connection reset")))
      const client = createMockClient({ kbAdd: kbAddMock })

      const verdict: PolicyVerdict = {
        allow: true,
        proofArtifact: {
          kbResult: { count: 0, entries: [] },
          planningStatus: { session_active: true, domains: {}, is_solved: false, reasoning_history: [] },
          outcome: {
            stop_signal: "Solved",
            constraint_state: { domains: { research_completed: [1] }, solved: true, solved_count: 6, total_count: 6 },
            iterations_used: 1,
          },
        },
      }

      //#when / #then
      await expect(
        writeAllowedPlanPattern({ client, verdict, planName: "fail-plan", sessionID: "ses-test-3" })
      ).resolves.toBeUndefined()

      expect(kbAddMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given a verdict with no proofArtifact", () => {
    it("#when proofArtifact is undefined #then skips KB write", async () => {
      //#given
      const kbAddMock = mock(() => Promise.resolve({ id: "kb_noop" }))
      const client = createMockClient({ kbAdd: kbAddMock })

      const verdict: PolicyVerdict = { allow: true }

      //#when
      await writeAllowedPlanPattern({ client, verdict, planName: "no-artifact", sessionID: "ses-test-4" })

      //#then
      expect(kbAddMock).toHaveBeenCalledTimes(0)
    })
  })
})
