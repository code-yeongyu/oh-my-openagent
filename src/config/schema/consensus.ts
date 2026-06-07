import { z } from "zod"

/**
 * Default voter lineages. Spans frontier closed-source labs + open-weights to maximize blind-spot coverage
 * across model families. The synthesizer is the calling agent itself (no separate synthesizer agent),
 * so voter lineages should typically differ from the calling model's lineage.
 */
export const DEFAULT_VOTER_LINEAGES = ["claude-opus", "gpt", "gemini-flash", "kimi"] as const

const PreQuestionGateConfigSchema = z.object({
  /** Whether the pre-question gate is enabled (default: true). When enabled, agent attempts to ask the user are intercepted and consensus runs first to either resolve internally or let the question through. */
  enabled: z.boolean().optional(),
  /** Voter count for pre-question consensus (default: 3, min: 2, max: 7) */
  voter_count: z.number().int().min(2).max(7).optional(),
})

const PostTestGateConfigSchema = z.object({
  /** Whether the post-test gate is enabled (default: true). When enabled, consensus runs on test output to validate pass/fail interpretation. */
  enabled: z.boolean().optional(),
  /** Regex patterns matched against bash commands to detect test runs. Defaults to common test runners (npm test, bun test, pytest, cargo test, go test, jest, vitest, mocha, rspec, phpunit, gradle test). */
  command_patterns: z.array(z.string()).optional(),
  /** Voter count for post-test consensus (default: 3) */
  voter_count: z.number().int().min(2).max(7).optional(),
})

export const ConsensusConfigSchema = z.object({
  /** Whether the consensus subsystem is enabled at all (default: true). When false, the consensus tool is unregistered and gates are no-ops. */
  enabled: z.boolean().optional(),
  /** Default voter count when not specified per-call (default: 3) */
  default_voter_count: z.number().int().min(2).max(7).optional(),
  /** Default voter lineages (model families) ordered by preference. Used when no explicit lineage list is passed. */
  default_voter_lineages: z.array(z.string()).optional(),
  /** Per-voter timeout in milliseconds (default: 120000 = 2 minutes). Voters that exceed this are recorded as timed-out positions. */
  voter_timeout_ms: z.number().int().min(10000).optional(),
  /** Reasoning effort each voter runs at (default: "high"). Consensus is used for high-stakes decisions, so voters reason deliberately by default. Lower it to reduce cost/latency. */
  voter_reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  /** Pre-question consensus gate: intercepts agent attempts to ask the user a question. */
  pre_question_gate: PreQuestionGateConfigSchema.optional(),
  /** Post-test consensus gate: runs consensus on test output after test commands execute. */
  post_test_gate: PostTestGateConfigSchema.optional(),
})

export type ConsensusConfig = z.infer<typeof ConsensusConfigSchema>
export type PreQuestionGateConfig = z.infer<typeof PreQuestionGateConfigSchema>
export type PostTestGateConfig = z.infer<typeof PostTestGateConfigSchema>
