/**
 * Continuity Ledger Types
 *
 * Ledgers preserve session state across /clear operations.
 * Unlike compaction (lossy), ledgers maintain full fidelity.
 */

export interface LedgerState {
  done: string[];
  now: string;
  next: string[];
}

export interface LedgerMetadata {
  sessionName: string;
  updatedAt: string;
  createdAt: string;
  filePath: string;
}

export interface Ledger {
  metadata: LedgerMetadata;
  goal: string;
  constraints: string[];
  keyDecisions: Array<{
    decision: string;
    rationale: string;
  }>;
  state: LedgerState;
  openQuestions: string[];
  workingSet: {
    branch?: string;
    keyFiles: string[];
    testCmd?: string;
    buildCmd?: string;
  };
  agentReports: Array<{
    timestamp: string;
    agent: string;
    summary: string;
  }>;
  rawContent?: string;
}

export interface LedgerConfig {
  /** Directory for ledger files (default: thoughts/ledgers) */
  ledgerDir: string;
  /** Auto-prune old agent reports (keep last N) */
  maxAgentReports: number;
  /** Auto-update ledger on significant events */
  autoUpdate: boolean;
}

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  ledgerDir: "thoughts/ledgers",
  maxAgentReports: 10,
  autoUpdate: true,
};

export interface ContinuityConfig {
  /** Enable continuity features */
  enabled: boolean;
  /** Ledger configuration */
  ledger: LedgerConfig;
  /** Auto-save threshold (percentage of context window, 0-1) */
  autoSaveThreshold: number;
  /** Auto-clear after saving (instead of compact) */
  autoClearAfterSave: boolean;
  /** Context warning thresholds */
  contextThresholds: {
    yellow: number; // Warning (default: 0.6)
    red: number; // Critical (default: 0.8)
    critical: number; // Auto-save trigger (default: 0.85)
  };
}

export const DEFAULT_CONTINUITY_CONFIG: ContinuityConfig = {
  enabled: true,
  ledger: DEFAULT_LEDGER_CONFIG,
  autoSaveThreshold: 0.85,
  autoClearAfterSave: false,
  contextThresholds: {
    yellow: 0.6,
    red: 0.8,
    critical: 0.85,
  },
};
