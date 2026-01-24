import { Command } from 'commander';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { indexCommand } from './commands/index-command.js';
import { selectCommand, selectMultiCommand } from './commands/select-command.js';
import { formatCommand } from './commands/format-command.js';
import { ExitCode } from './utils/exit-codes.js';
import { isStdinPiped } from './utils/file-reader.js';

// ESM-compatible way to read package.json
// Path is relative to the built dist/cli.mjs file
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { description: string; version: string };

/**
 * Split a selector string on commas that separate different selectors.
 * Commas inside brackets or that are followed by digits (index lists) are not split.
 *
 * Examples:
 * - "h1.0,h2.0" → ["h1.0", "h2.0"] (comma separates selectors)
 * - "h2.0,2,4" → ["h2.0,2,4"] (comma is part of index list)
 * - "h2[0,2,4]" → ["h2[0,2,4]"] (comma inside brackets)
 * - "h1.0,h2.0,2,4,h3.0" → ["h1.0", "h2.0,2,4", "h3.0"]
 */
function splitSelectorList(input: string): string[] {
  // Preserve empty strings as-is (they'll be handled as invalid selectors downstream)
  if (input === '') {
    return [''];
  }

  const selectors: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '[') {
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth--;
      current += char;
    } else if (char === ',' && bracketDepth === 0) {
      // Check what follows the comma
      const rest = input.slice(i + 1);
      const nextNonSpace = rest.trimStart();

      // If next character is a digit, this is an index list continuation
      if (/^\d/.test(nextNonSpace)) {
        current += char;
      } else {
        // This is a selector separator
        if (current.trim()) {
          selectors.push(current.trim());
        }
        current = '';
      }
    } else {
      current += char;
    }
  }

  // Add the last selector
  if (current.trim()) {
    selectors.push(current.trim());
  }

  return selectors;
}

/**
 * Determine if an argument is a file path or a selector.
 * Files: end with .md/.markdown, or exist on disk
 * Selectors: everything else
 */
function isFilePath(arg: string): boolean {
  // Common markdown extensions
  if (/\.(md|markdown)$/i.test(arg)) {
    return true;
  }
  // Check if file exists on disk
  if (existsSync(arg)) {
    return true;
  }
  return false;
}

/**
 * Partition arguments into files and selectors.
 * Comma-separated selectors are expanded into multiple selectors.
 */
function partitionArgs(args: string[]): { files: string[]; selectors: string[] } {
  const files: string[] = [];
  const selectors: string[] = [];

  for (const arg of args) {
    if (isFilePath(arg)) {
      files.push(arg);
    } else {
      // Expand comma-separated selectors
      const expanded = splitSelectorList(arg);
      selectors.push(...expanded);
    }
  }

  return { files, selectors };
}

const program = new Command();

program
  .name('mdsel')
  .description(
    `${pkg.description}

Examples:
  mdsel README.md                 Index document structure
  mdsel h2.1 README.md            Select second h2 section
  mdsel '*' README.md             Select entire document
  mdsel "h2.1/code.0" README.md   Select nested content
  mdsel "installation" README.md  Fuzzy search
  mdsel --json README.md          Output as JSON`
  )
  .version(pkg.version)
  .option('--json', 'Output JSON instead of text')
  .argument('[args...]', 'Markdown files and selectors (auto-detected)')
  .action(async (args: string[]) => {
    try {
      const globalOpts = program.opts<{ json?: boolean }>();

      // No arguments at all - show help (unless stdin is piped)
      if (args.length === 0) {
        if (isStdinPiped()) {
          // Handle stdin input
          await indexCommand([], { json: globalOpts.json });
          return;
        }
        program.outputHelp();
        process.exit(0);
      }

      // Partition into files and selectors
      const { files, selectors } = partitionArgs(args);

      // No files found - show error
      if (files.length === 0) {
        console.error('Error: No markdown files provided.');
        console.error('Usage: mdsel <file.md> [selector...]');
        process.exit(ExitCode.ERROR);
      }

      // Files only → index
      if (selectors.length === 0) {
        await indexCommand(files, { json: globalOpts.json });
        return;
      }

      // Files + selectors → select
      if (selectors.length === 1) {
        await selectCommand(selectors[0]!, files, { json: globalOpts.json });
      } else {
        await selectMultiCommand(selectors, files, { json: globalOpts.json });
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(ExitCode.ERROR);
    }
  });

// Keep format as explicit command (not file/selector based)
program
  .command('format')
  .description('Output format specification for tool descriptions')
  .argument('[command]', 'Command to describe (index, select, or omit for all)')
  .option('--example', 'Show example output instead of terse spec')
  .action((command: string | undefined, options: { example?: boolean }) => {
    formatCommand(command, options);
  });

// Explicit `index` subcommand (alternative syntax)
program
  .command('index')
  .description('Index markdown files (alternative to: mdsel <files>)')
  .argument('<files...>', 'Markdown files to index')
  .action(async (files: string[]) => {
    try {
      const globalOpts = program.opts<{ json?: boolean }>();
      await indexCommand(files, { json: globalOpts.json });
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(ExitCode.ERROR);
    }
  });

// Explicit `select` subcommand (alternative syntax)
program
  .command('select')
  .description('Select content (alternative to: mdsel <selector> <files>)')
  .argument('<selector>', 'Selector to match')
  .argument('<files...>', 'Markdown files to search')
  .action(async (selector: string, files: string[]) => {
    try {
      const globalOpts = program.opts<{ json?: boolean }>();
      const selectors = splitSelectorList(selector);
      if (selectors.length === 1) {
        await selectCommand(selectors[0]!, files, { json: globalOpts.json });
      } else {
        await selectMultiCommand(selectors, files, { json: globalOpts.json });
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(ExitCode.ERROR);
    }
  });

program.parse();
