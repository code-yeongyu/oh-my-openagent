/// <reference path="./bun-test.d.ts" />

import { describe, expect, it, mock } from "bun:test"
import {
  clearChallengeState,
  evaluateEpistemicInterlockGate,
  isEpistemicInterlockCandidate,
} from "./epistemic-interlock-gate"
import type { CandidateAction } from "./types"
import type { ReasoningCoreClient } from "./reasoning-core-client"

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock(() => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 4 })),
    kbQuery: mock(() => Promise.resolve({ count: 0, entries: [] })),
    kbAdd: mock(() => Promise.resolve({ id: "kb_test_123" })),
    kbRemove: mock(() => Promise.resolve()),
    check: mock(() => Promise.resolve({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(() => Promise.resolve({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  }
}

function createCandidate(tool: string, agent: string, filePath?: string): CandidateAction {
  return {
    tool,
    sessionID: "test-session",
    agent,
    args: filePath ? { file_path: filePath } : {},
  }
}

function getFirstCallArgument(fn: ReturnType<typeof mock>): unknown {
  const calls = (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls
  return calls[0]?.[0]
}

describe("epistemic-interlock-gate", () => {
  describe("#given candidate detection", () => {
    it("#when write by non-prometheus agent #then returns true", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("write", "sisyphus"))).toBe(true)
    })

    it("#when edit by non-prometheus agent #then returns true", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("edit", "hephaestus"))).toBe(true)
    })

    it("#when write by prometheus agent #then returns false", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("write", "prometheus"))).toBe(false)
    })

    it("#when bash tool #then returns false", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("bash", "sisyphus"))).toBe(false)
    })

    it("#when read tool #then returns false", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("read", "sisyphus"))).toBe(false)
    })

    it("#when write by themis agent #then returns false", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("write", "themis"))).toBe(false)
    })

    it("#when edit by themis agent #then returns false", () => {
      expect(isEpistemicInterlockCandidate(createCandidate("edit", "themis"))).toBe(false)
    })

    it("#when write to .sisyphus/deliberations path #then returns false", () => {
      expect(isEpistemicInterlockCandidate({
        tool: "write",
        sessionID: "test",
        agent: "sisyphus",
        args: { filePath: ".sisyphus/deliberations/foo.md" },
      })).toBe(false)
    })

    it("#when edit to .sisyphus/deliberations path with snake_case file_path #then returns false", () => {
      expect(isEpistemicInterlockCandidate({
        tool: "edit",
        sessionID: "test",
        agent: "hephaestus",
        args: { file_path: ".sisyphus/deliberations/subdir/bar.md" },
      })).toBe(false)
    })

    it("#when write to .sisyphus/deliberations with absolute path #then returns false", () => {
      expect(isEpistemicInterlockCandidate({
        tool: "write",
        sessionID: "test",
        agent: "sisyphus",
        args: { filePath: "/Users/x/project/.sisyphus/deliberations/request.md" },
      })).toBe(false)
    })

    it("#when write to .sisyphus/plans path #then still returns true (not exempted)", () => {
      expect(isEpistemicInterlockCandidate({
        tool: "write",
        sessionID: "test",
        agent: "sisyphus",
        args: { filePath: ".sisyphus/plans/foo.md" },
      })).toBe(true)
    })
  })

  describe("#given filePath field normalization", () => {
    it("#when args uses camelCase filePath #then evaluateEpistemicInterlockGate reads it correctly", async () => {
      clearChallengeState("test-session-camel")
      const entries = [{ tags: ["constraint:no_updates"] }]
      const kbQuery = mock((query: { similarity_query: string }) =>
        Promise.resolve({ count: 1, entries }),
      )
      const evaluate = mock(() => Promise.resolve({ allow: false, reason: "blocked" }))
      const client = createMockClient({ kbQuery, evaluate })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: {
          tool: "write",
          sessionID: "test-session-camel",
          agent: "sisyphus",
          args: { filePath: "src/camel-foo.ts" },
        },
      })
      expect(verdict.allow).toBe(false)
      const kbQueryCall = (kbQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { similarity_query: string }
      expect(kbQueryCall?.similarity_query).toBe("architectural constraint src/camel-foo.ts")
    })

    it("#when args uses path instead of filePath #then extractCandidateFilePath picks it up", async () => {
      clearChallengeState("test-session-2")
      const kbQuery = mock(() => Promise.resolve({ count: 0, entries: [] }))
      const client = createMockClient({ kbQuery })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: {
          tool: "write",
          sessionID: "test-session-2",
          agent: "sisyphus",
          args: { path: "src/bar.ts" },
        },
      })
      expect(verdict.allow).toBe(true)
      const kbQueryCall = (kbQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { similarity_query: string }
      expect(kbQueryCall?.similarity_query).toBe("architectural constraint src/bar.ts")
    })
  })

  describe("#given bare tag handling", () => {
    it("#when KB entries have unprefixed tags #then bare tags are ignored in the theory (no kb_constraint rules)", async () => {
      clearChallengeState("test-session-bare")
      const entries = [{ tags: ["wave-3", "verification", "planning-memo"] }]
      const evaluate = mock(() => Promise.resolve({ allow: true }))
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries })),
        evaluate,
      })
      await evaluateEpistemicInterlockGate({
        client,
        candidate: {
          tool: "write",
          sessionID: "test-session-bare",
          agent: "sisyphus",
          args: { filePath: "src/baz.ts" },
        },
      })
      const evaluateCall = (evaluate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
        sessionContext: { theory_override: { defeasible_rules: Array<{ id: string }> } }
      }
      const ruleIds = evaluateCall.sessionContext.theory_override.defeasible_rules.map(r => r.id)
      expect(ruleIds.some(id => id.startsWith("kb-constraint-wave"))).toBe(false)
      expect(ruleIds.some(id => id.startsWith("kb-constraint-verification"))).toBe(false)
      expect(ruleIds.some(id => id.startsWith("kb-constraint-planning"))).toBe(false)
    })

    it("#when KB entries mix bare and constraint: prefixed tags #then only prefixed tags contribute", async () => {
      clearChallengeState("test-session-mix")
      const entries = [{ tags: ["bare-tag", "constraint:real_constraint", "another-bare"] }]
      const evaluate = mock(() => Promise.resolve({ allow: true }))
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries })),
        evaluate,
      })
      await evaluateEpistemicInterlockGate({
        client,
        candidate: {
          tool: "write",
          sessionID: "test-session-mix",
          agent: "sisyphus",
          args: { filePath: "src/qux.ts" },
        },
      })
      const evaluateCall = (evaluate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
        sessionContext: { theory_override: { defeasible_rules: Array<{ id: string }> } }
      }
      const ruleIds = evaluateCall.sessionContext.theory_override.defeasible_rules.map(r => r.id)
      expect(ruleIds).toContain("kb-constraint-real_constraint")
      expect(ruleIds.some(id => id.startsWith("kb-constraint-bare"))).toBe(false)
      expect(ruleIds.some(id => id.startsWith("kb-constraint-another"))).toBe(false)
    })
  })

  describe("#given empty KB", () => {
    it("#when evaluateEpistemicInterlockGate called #then returns allow=true without adversarial flag", async () => {
      const client = createMockClient({ kbQuery: mock(() => Promise.resolve({ count: 0, entries: [] })) })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("write", "sisyphus", "src/foo.ts"),
      })
      expect(verdict.allow).toBe(true)
      expect(verdict.needsAdversarialCheck).toBeUndefined()
    })
  })

  describe("#given KB has entries", () => {
    it("#when KB constraint defeats mutation on first attempt #then returns structured challenge block", async () => {
      clearChallengeState("test-session")
      const entries = [{ tags: ["constraint:no_generated_updates"], content: { Insight: { lesson: "Prefer reviewed edits" } } }]
      const evaluate = mock(() => Promise.resolve({ allow: false }))
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries })),
        evaluate,
      })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("edit", "sisyphus", "src/bar.ts"),
      })
      expect(verdict).toEqual({
        allow: false,
        reason: "Epistemic Interlock: Write blocked. KB constraint defeats mutation on src/bar.ts: adversarial theory rejected. To proceed: call reason_argue with an ASPIC+ theory that produces an authorization conclusion such as mutation_authorized_on_unknown_path or allow_action(current). The proof will be automatically persisted to the Learned KB, then retry the Write. If the counter-theory is rejected, the block is legitimate.",
      })
      expect(evaluate).toHaveBeenCalledTimes(1)
      const firstEvaluateCall = getFirstCallArgument(evaluate) as {
        candidate: CandidateAction
        sessionContext: { theory_override: { premises: unknown[]; defeasible_rules: unknown[] } }
      }
      expect(firstEvaluateCall.candidate).toEqual(createCandidate("edit", "sisyphus", "src/bar.ts"))
      expect(firstEvaluateCall.sessionContext.theory_override.premises.some(premise => JSON.stringify(premise) === JSON.stringify({ formula: "mutation_proposed(current)", kind: "ordinary" }))).toBe(true)
      expect(firstEvaluateCall.sessionContext.theory_override.premises.some(premise => JSON.stringify(premise) === JSON.stringify({ formula: "kb_constraint_no_generated_updates(current)", kind: "ordinary" }))).toBe(true)
      expect(firstEvaluateCall.sessionContext.theory_override.defeasible_rules.some(rule => JSON.stringify(rule) === JSON.stringify({
        id: "kb-constraint-no_generated_updates",
        antecedents: ["kb_constraint_no_generated_updates(current)", "mutation_proposed(current)"],
        consequent: "deny_action(current)",
      }))).toBe(true)
    })

    it("#when new counter-argument proof appears after challenge #then allows retry", async () => {
      clearChallengeState("test-session")
      const entries = [{ tags: ["constraint:no_generated_updates"], content: { Insight: { lesson: "Prefer reviewed edits" } } }]
      let shouldAllowRetry = false
      const kbQuery = mock((query: { similarity_query: string }) => {
        if (query.similarity_query === "counter-argument proof src/bar.ts") {
          return Promise.resolve({ count: 2, entries: [{ id: "proof-1" }, { id: "proof-2" }] })
        }

        return Promise.resolve({ count: 1, entries })
      })
      const evaluate = mock(() => Promise.resolve({ allow: shouldAllowRetry }))
      const client = createMockClient({ kbQuery, evaluate })

      const firstVerdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("edit", "sisyphus", "src/bar.ts"),
      })

      expect(firstVerdict.allow).toBe(false)

      shouldAllowRetry = true

      const retryVerdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("edit", "sisyphus", "src/bar.ts"),
      })

      expect(retryVerdict).toEqual({ allow: true })
    })

    it("#when KB supports mutation #then returns allow=true", async () => {
      const entries = [{
        tags: ["support:scoped_update", "constraint:scoped_update", "prefer:support:scoped_update"],
        content: { Insight: { lesson: "Scoped edits are safe when tightly bounded" } },
      }]
      const evaluate = mock(() => Promise.resolve({ allow: true }))
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries })),
        evaluate,
      })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("edit", "sisyphus", "src/bar.ts"),
      })
      expect(verdict).toEqual({ allow: true })
      const supportEvaluateCall = getFirstCallArgument(evaluate) as {
        sessionContext: { theory_override: { defeasible_rules: unknown[]; preferences: unknown[] } }
      }
      expect(supportEvaluateCall.sessionContext.theory_override.defeasible_rules.some(rule => JSON.stringify(rule) === JSON.stringify({
        id: "kb-support-scoped_update",
        antecedents: ["kb_support_scoped_update(current)", "mutation_proposed(current)"],
        consequent: "allow_action(current)",
      }))).toBe(true)
      expect(supportEvaluateCall.sessionContext.theory_override.defeasible_rules.some(rule => JSON.stringify(rule) === JSON.stringify({
        id: "kb-constraint-scoped_update",
        antecedents: ["kb_constraint_scoped_update(current)", "mutation_proposed(current)"],
        consequent: "deny_action(current)",
      }))).toBe(true)
      expect(supportEvaluateCall.sessionContext.theory_override.preferences).toEqual([
        { inferior: "kb-constraint-scoped_update", superior: "kb-support-scoped_update" },
      ])
    })
  })

  describe("#given config toggle", () => {
    it("#when epistemic_interlock_enabled is false #then returns allow=true immediately", async () => {
      clearChallengeState("test-session")
      const kbQueryMock = mock(() => Promise.resolve({ count: 1, entries: [{}] }))
      const client = createMockClient({ kbQuery: kbQueryMock })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("write", "sisyphus"),
        config: { epistemic_interlock_enabled: false },
      })
      expect(verdict.allow).toBe(true)
      expect(kbQueryMock).not.toHaveBeenCalled()
    })
  })

  describe("#given infrastructure error", () => {
    it("#when evaluate throws and fail_mode is open (default) #then returns allow=true (graceful degradation)", async () => {
      clearChallengeState("test-session")
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries: [{ tags: ["constraint:architecture"] }] })),
        evaluate: mock(() => Promise.reject(new Error("connection failed"))),
      })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("write", "sisyphus", "src/baz.ts"),
      })
      expect(verdict.allow).toBe(true)
    })

    it("#when evaluate throws and fail_mode is closed #then returns allow=false with structured rationale", async () => {
      clearChallengeState("test-session")
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries: [{ tags: ["constraint:architecture"] }] })),
        evaluate: mock(() => Promise.reject(new Error("reasoning-core unreachable"))),
      })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("write", "sisyphus", "src/baz.ts"),
        config: { infrastructure_fail_mode: "closed" },
      })
      expect(verdict.allow).toBe(false)
      expect(verdict.reason).toBeDefined()
      expect((verdict.reason ?? "").includes("fail-closed")).toBe(true)
      expect((verdict.reason ?? "").includes("reasoning-core unreachable")).toBe(true)
      expect((verdict.reason ?? "").includes("infrastructure_fail_mode")).toBe(true)
    })

    it("#when kbQuery throws and fail_mode is closed #then blocks the action", async () => {
      clearChallengeState("test-session")
      const client = createMockClient({
        kbQuery: mock(() => Promise.reject(new Error("KB store unavailable"))),
      })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("write", "sisyphus", "src/qux.ts"),
        config: { infrastructure_fail_mode: "closed" },
      })
      expect(verdict.allow).toBe(false)
      expect((verdict.reason ?? "").includes("fail-closed")).toBe(true)
    })

    it("#when fail_mode is explicitly open #then preserves graceful degradation", async () => {
      clearChallengeState("test-session")
      const client = createMockClient({
        evaluate: mock(() => Promise.reject(new Error("downstream timeout"))),
        kbQuery: mock(() => Promise.resolve({ count: 1, entries: [{ tags: ["constraint:test"] }] })),
      })
      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate: createCandidate("write", "sisyphus", "src/explicit-open.ts"),
        config: { infrastructure_fail_mode: "open" },
      })
      expect(verdict.allow).toBe(true)
    })
  })
})
