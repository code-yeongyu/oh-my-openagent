/// <reference path="./bun-test.d.ts" />

import { afterAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { createReasoningCoreClient } from "./reasoning-core-client"
import {
  evaluateDestructiveAction,
  clearDestructiveCache,
  type DestructiveActionResult,
} from "./destructive-action-gate"

const BINARY_PATH = process.env.REASONING_CORE_BINARY_PATH
  ?? "/Users/unluckyg/Documents/reasoning-core/target/release/reasoning-core"
const LIVE_GUARD = process.env.RUN_E2E_LIVE === "1"
const HAS_BINARY = existsSync(BINARY_PATH)
const SHOULD_RUN = LIVE_GUARD && HAS_BINARY

const describeLive = SHOULD_RUN ? describe : describe.skip

describeLive("e2e reasoning-core (live binary)", () => {
  const client = createReasoningCoreClient({
    mode: "stdio",
    binaryPath: BINARY_PATH,
    timeoutMs: 30000,
  })

  afterAll(() => {
    if (typeof (client as unknown as { dispose?: () => void }).dispose === "function") {
      (client as unknown as { dispose: () => void }).dispose()
    }
  })

  it("argue: single strict rule produces accepted conclusion with proof_chain", async () => {
    if (!client.argue) throw new Error("client.argue not available")

    const result = (await client.argue({
      theory: {
        premises: [
          { formula: "ha_motivo_valido", kind: "ordinary" },
        ],
        strict_rules: [
          { id: "sr1", antecedents: ["ha_motivo_valido"], consequent: "azione_giustificata" },
        ],
        defeasible_rules: [],
        preferences: [],
        classical_negation: true,
      },
      semantics: "grounded",
    })) as {
      conclusions?: Record<string, {
        status?: string
        proof_chain?: Array<{ conclusion: string; rule_id: string | null; rule_kind: string }>
      }>
    }

    expect(result.conclusions).toBeDefined()
    const verdict = result.conclusions?.azione_giustificata
    expect(verdict?.status).toBe("Accepted")
    expect(verdict?.proof_chain).toBeDefined()
    expect(verdict?.proof_chain?.length).toBeGreaterThan(0)
    const ruleIds = (verdict?.proof_chain ?? []).map((step) => step.rule_id).filter((id): id is string => typeof id === "string")
    expect(ruleIds).toContain("sr1")
  })

  it("argue: contradictory rules with preferences resolve via preferred semantics", async () => {
    if (!client.argue) throw new Error("client.argue not available")

    const result = (await client.argue({
      theory: {
        premises: [
          { formula: "premio_a", kind: "ordinary" },
          { formula: "premio_b", kind: "ordinary" },
        ],
        strict_rules: [],
        defeasible_rules: [
          { id: "drA", antecedents: ["premio_a"], consequent: "scelta_alpha" },
          { id: "drB", antecedents: ["premio_b"], consequent: "scelta_beta" },
        ],
        preferences: [
          { superior: "drA", inferior: "drB" },
        ],
        classical_negation: true,
      },
      semantics: "preferred",
    })) as {
      conclusions?: Record<string, { status?: string }>
    }

    expect(result.conclusions).toBeDefined()
    expect(result.conclusions?.scelta_alpha).toBeDefined()
    expect(result.conclusions?.scelta_beta).toBeDefined()
  })

  it("destructive gate: rm -rf / produces blocked verdict via dynamic ASPIC+ theory", async () => {
    clearDestructiveCache()
    const result = await evaluateDestructiveAction(client, "bash", { command: "rm -rf /" })
    expect(result).not.toBeNull()
    const blocked = result as DestructiveActionResult
    expect(blocked.blocked).toBe(true)
    expect(blocked.fired_rules.length).toBeGreaterThan(0)
    const expectedRules = ["sr-rm-recursive-root", "sr-rm-system-path", "sr-rm-absolute-path"]
    const hasExpectedRule = blocked.fired_rules.some((r) => expectedRules.includes(r))
    expect(hasExpectedRule).toBe(true)
    expect(blocked.proof_chain.length).toBeGreaterThan(0)
  })

  it("destructive gate: write to .env produces blocked verdict via dynamic ASPIC+ theory", async () => {
    clearDestructiveCache()
    const result = await evaluateDestructiveAction(client, "write", { file_path: ".env" })
    expect(result).not.toBeNull()
    const blocked = result as DestructiveActionResult
    expect(blocked.fired_rules).toContain("sr-write-dotenv")
    const proofRuleIds = blocked.proof_chain.map((s) => s.rule_id).filter((id): id is string => typeof id === "string")
    expect(proofRuleIds).toContain("sr-write-dotenv")
  })

  it("destructive gate: write to src/foo.ts is allowed (no firing rules)", async () => {
    clearDestructiveCache()
    const result = await evaluateDestructiveAction(client, "write", { file_path: "src/foo.ts" })
    expect(result).toBeNull()
  })

  it("destructive gate: caches verdict for repeat invocation", async () => {
    clearDestructiveCache()
    const r1 = await evaluateDestructiveAction(client, "bash", { command: "rm -rf /" })
    const r2 = await evaluateDestructiveAction(client, "bash", { command: "rm -rf /" })
    expect(r1).toBeDefined()
    expect(r2).toBeDefined()
    expect((r1 as DestructiveActionResult).fired_rules).toEqual((r2 as DestructiveActionResult).fired_rules)
  })

  it("solve: variables + constraint converges to assignment", async () => {
    if (!client.solve) throw new Error("client.solve not available")

    const result = (await client.solve({
      description: "X must equal 1",
      variables: [{ name: "X", domain: [0, 1, 2] }],
      initial_constraints: [
        { constraint: { Equals: { variable: "X", value: 1 } } },
      ],
      max_iterations: 5,
      theory: {
        premises: [],
        strict_rules: [],
        defeasible_rules: [],
        preferences: [],
        classical_negation: true,
      },
    })) as {
      stop_signal?: string
      constraint_state?: { domains?: Record<string, number[]> }
    }

    expect(result.stop_signal).toBeDefined()
    expect(result.constraint_state?.domains?.X).toEqual([1])
  })
})

describe("e2e reasoning-core test guard", () => {
  it("reports configuration", () => {
    expect(typeof BINARY_PATH).toBe("string")
    expect(typeof LIVE_GUARD).toBe("boolean")
  })
})
