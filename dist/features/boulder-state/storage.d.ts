/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */
import type { BoulderState, PlanProgress } from "./types";
export declare function getBoulderFilePath(directory: string): string;
export declare function readBoulderState(directory: string): BoulderState | null;
export declare function writeBoulderState(directory: string, state: BoulderState): boolean;
export declare function appendSessionId(directory: string, sessionId: string): BoulderState | null;
export declare function clearBoulderState(directory: string): boolean;
/**
 * Find Prometheus plan files for this project.
 * Prometheus stores plans at: {project}/.sisyphus/plans/{name}.md
 */
export declare function findPrometheusPlans(directory: string): string[];
/**
 * Parse a plan file and count checkbox progress.
 */
export declare function getPlanProgress(planPath: string): PlanProgress;
/**
 * Extract plan name from file path.
 */
export declare function getPlanName(planPath: string): string;
/**
 * Create a new boulder state for a plan.
 */
export declare function createBoulderState(planPath: string, sessionId: string, agent?: string, worktreePath?: string): BoulderState;
