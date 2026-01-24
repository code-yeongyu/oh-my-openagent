/**
 * Exit codes for CLI commands.
 *
 * @module cli/utils/exit-codes
 */

/**
 * Exit code constants following Unix conventions.
 *
 * - SUCCESS (0): All operations completed successfully
 * - ERROR (1): Complete failure (file not found, parse error, etc.)
 * - USAGE_ERROR (2): Invalid arguments or usage
 */
export const ExitCode = {
  /** All operations completed successfully */
  SUCCESS: 0,
  /** Complete failure (file not found, parse error, etc.) */
  ERROR: 1,
  /** Invalid arguments or usage */
  USAGE_ERROR: 2,
} as const;

/**
 * Type for exit code values.
 */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Exit the process with the given code.
 *
 * @param code - The exit code to use
 */
export function exitWithCode(code: ExitCodeValue): never {
  process.exit(code);
}
