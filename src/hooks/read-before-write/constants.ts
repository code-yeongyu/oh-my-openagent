import type { ReadBeforeWriteConfig } from "./types";

/**
 * Hook name for registration and logging.
 */
export const HOOK_NAME = "read-before-write";

/**
 * Maximum number of files to track per session.
 * Uses LRU eviction when exceeded.
 */
export const MAX_TRACKED_FILES = 10000;

/**
 * Default configuration for the read-before-write hook.
 */
export const DEFAULT_CONFIG: ReadBeforeWriteConfig = {
  enabled: true,
  mode: "block",
  exempt_tools: [
    "lsp_rename",
    "lsp_code_action_resolve",
    "ast_grep_replace",
    "memory_write",
    "memory_edit",
    "memory_delete",
    "create_spec_folder",
    "update_workflow_state",
  ],
  exempt_paths: [
    "dist/**",
    "build/**",
    "node_modules/**",
    ".git/**",
  ],
};

/**
 * Error messages for blocked operations.
 * Uses ASCII prefixes for terminal compatibility.
 */
export const ERROR_MESSAGES = {
  /**
   * Message when an edit is blocked due to missing read.
   */
  blocked: (filePath: string): string =>
    `[BLOCKED] Read-Before-Write: Cannot edit file without reading it first.\nFile: ${filePath}\nAction: Use the Read tool to read "${filePath}" before editing.`,
};

/**
 * Warning messages for warn mode.
 * Uses ASCII prefixes for terminal compatibility.
 */
export const WARNING_MESSAGES = {
  /**
   * Message when editing without prior read in warn mode.
   */
  noRead: (filePath: string): string =>
    `[WARNING] Read-Before-Write: Editing file without prior read: ${filePath}\nConsider reading files before editing to ensure you have the latest content.`,
  
  /**
   * Message when session ID is missing.
   */
  missingSession: (): string =>
    `[WARNING] Read-Before-Write: Missing sessionID, skipping enforcement (fail-open).`,
};
