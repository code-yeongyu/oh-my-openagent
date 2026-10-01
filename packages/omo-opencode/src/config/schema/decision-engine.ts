import { z } from "zod"

const JevCircuitBreakerSchema = z
  .object({
    failures: z
      .number()
      .int()
      .min(1)
      .default(3)
      .describe("Consecutive failures that open the circuit."),
    cooldown_ms: z
      .number()
      .int()
      .min(1000)
      .default(600_000)
      .describe("Cooldown before retrying a tripped circuit (ms)."),
  })
  .describe("Jev circuit breaker tuning.")

const JevBudgetSchema = z
  .object({
    monthly_cap_usd: z
      .number()
      .positive()
      .default(2)
      .describe("Monthly spend cap for Jev decisions (USD)."),
    warn_at_usd: z
      .number()
      .positive()
      .default(1.5)
      .describe("Spend threshold that triggers a warning (USD)."),
  })
  .describe("Jev monthly budget guardrails.")

const JevConfigSchema = z
  .object({
    model: z.string().default("jev-1.13").describe("Jev model identifier."),
    base_url: z
      .string()
      .url()
      .default("https://opencode.ai/zen/v1")
      .describe("Jev API base URL."),
    confidence_threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.75)
      .describe("Minimum confidence required to accept a Jev decision."),
    max_attempts: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Maximum Jev decision attempts before fallback."),
    circuit_breaker: JevCircuitBreakerSchema.default(JevCircuitBreakerSchema.parse({})),
    budget: JevBudgetSchema.default(JevBudgetSchema.parse({})),
  })
  .describe("Jev decision-engine tuning.")

// Configuration for the manager decision engine. momo is replacing its LLM
// "manager" triage agent with a Jev (TypeSafe System One) decision engine; this
// block is the config switch that selects the engine and tunes its behavior.
// No task() wiring lives here yet — that is a later PR.
export const ManagerConfigSchema = z
  .object({
    decision_engine: z
      .enum(["jev", "heuristic", "llm"])
      .default("jev")
      .describe("Routing decision engine: jev (TypeSafe System One), heuristic, or llm."),
    jev: JevConfigSchema.default(JevConfigSchema.parse({})),
  })
  .describe("Manager decision-engine configuration (routing/triage).")

export type ManagerConfig = z.infer<typeof ManagerConfigSchema>
