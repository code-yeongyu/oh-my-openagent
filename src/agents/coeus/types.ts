/**
 * Coeus: Recursive Divide-and-Conquer Planning
 * Type definitions for complexity scoring and decomposition decisions
 */

/**
 * Complexity score for a planning problem
 * Used to determine if decomposition is needed
 */
export interface ComplexityScore {
  /** Composite score from 0-100 */
  total: number;
  /** Number of distinct domains/concerns */
  concern_count: number;
  /** Estimated number of files affected */
  file_count_estimate: number;
  /** Whether problem spans multiple domains (frontend+backend+infra) */
  cross_domain: boolean;
  /** Reasoning for the score */
  reasoning: string;
}

/**
 * Decision on whether and how to decompose a planning problem
 */
export interface DecompositionDecision {
  /** Whether decomposition should occur */
  should_decompose: boolean;
  /** List of identified domains (e.g., ["auth", "frontend", "database"]) */
  domains: string[];
  /** Decomposition strategy */
  strategy: "domain" | "feature" | "hybrid";
  /** Rationale for the decision */
  rationale: string;
}

/**
 * Complexity score threshold that forces decomposition
 * Problems with score >= 40 must be decomposed
 */
export const DECOMPOSITION_THRESHOLD = 40;

/**
 * Minimum number of tasks per sub-plan
 * Sub-plans must contain at least this many tasks
 */
export const MIN_TASKS_PER_SUB_PLAN = 3;

/**
 * Minimum number of acceptance criteria per task
 * Each task must have at least this many acceptance criteria
 */
export const MIN_ACCEPTANCE_CRITERIA_PER_TASK = 2;
