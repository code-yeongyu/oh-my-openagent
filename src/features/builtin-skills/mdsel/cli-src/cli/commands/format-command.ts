/**
 * Format command implementation for CLI.
 *
 * Outputs format specification strings suitable for LLM tool descriptions.
 *
 * @module cli/commands/format-command
 */

import { FORMAT_SPECS } from '../../output/text-formatters.js';

export interface FormatOptions {
  /** Show example output instead of terse spec */
  example?: boolean;
}

/**
 * Execute the format command.
 *
 * Outputs format specification for the specified command(s).
 *
 * @param command - Command to describe ('index', 'select', or undefined for all)
 * @param options - Command options
 */
export function formatCommand(command: string | undefined, options: FormatOptions = {}): void {
  const style = options.example ? 'example' : 'terse';

  if (command === 'index') {
    console.log(FORMAT_SPECS.index[style]);
  } else if (command === 'select') {
    console.log(FORMAT_SPECS.select[style]);
  } else {
    // Output all specs
    console.log('# index');
    console.log(FORMAT_SPECS.index[style]);
    console.log('');
    console.log('# select');
    console.log(FORMAT_SPECS.select[style]);
  }
}
