/**
 * Read-Before-Write Enforcement Hook Types
 * 
 * Defines interfaces for tracking file reads and enforcing read-before-write behavior.
 */

/**
 * Represents a tracked file read operation.
 */
export interface FileReadEntry {
  /** Normalized absolute path of the file */
  filePath: string;
  /** Session that performed the read */
  sessionId: string;
  /** Timestamp when the read occurred */
  timestamp: number;
}

/**
 * Configuration for the read-before-write enforcement hook.
 */
export interface ReadBeforeWriteConfig {
  /** Master enable/disable switch */
  enabled: boolean;
  /** Enforcement mode: block prevents operation, warn logs but allows, disabled skips checks */
  mode: "block" | "warn" | "disabled";
  /** Tools that bypass enforcement (e.g., lsp_rename, memory_write) */
  exempt_tools: string[];
  /** Glob patterns for paths that bypass enforcement (e.g., dist/**, node_modules/**) */
  exempt_paths: string[];
}

/**
 * Result of an enforcement check.
 */
export interface EnforcementResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: "read_found" | "new_file" | "tool_exempt" | "path_exempt" | "disabled" | "session_missing";
  /** Optional message for logging or error display */
  message?: string;
}

/**
 * Statistics about the registry state.
 */
export interface RegistryStats {
  /** Total number of sessions being tracked */
  sessionCount: number;
  /** Total number of files tracked across all sessions */
  totalFilesTracked: number;
  /** Files tracked per session */
  filesPerSession: Map<string, number>;
}
