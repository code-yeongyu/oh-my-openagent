#!/usr/bin/env bun
/**
 * Build mdsel CLI as a self-contained bundle
 * 
 * This script bundles the mdsel CLI with all dependencies into a single file
 * that can be executed without any external node_modules.
 */

import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, "..")
const mdselSrcDir = join(projectRoot, "src/features/builtin-skills/mdsel/cli-src")
const outputPath = join(projectRoot, "src/features/builtin-skills/mdsel/cli.mjs")

async function main() {
  console.log("Building mdsel CLI bundle...")
  console.log(`  Source: ${mdselSrcDir}`)
  console.log(`  Output: ${outputPath}`)

  // Create a wrapper entry point that doesn't rely on package.json
  const entryContent = `
// Auto-generated entry point for bundled mdsel CLI
import { Command } from 'commander';
import { existsSync } from 'fs';
import { indexCommand } from './cli/commands/index-command.js';
import { selectCommand, selectMultiCommand } from './cli/commands/select-command.js';
import { formatCommand } from './cli/commands/format-command.js';
import { ExitCode } from './cli/utils/exit-codes.js';
import { isStdinPiped } from './cli/utils/file-reader.js';

const pkg = { 
  description: "Declarative Markdown semantic selection CLI for LLM agents",
  version: "0.1.3"
};

function splitSelectorList(input) {
  if (input === '') return [''];
  const selectors = [];
  let current = '';
  let bracketDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '[') { bracketDepth++; current += char; }
    else if (char === ']') { bracketDepth--; current += char; }
    else if (char === ',' && bracketDepth === 0) {
      const rest = input.slice(i + 1);
      const nextNonSpace = rest.trimStart();
      if (/^\\d/.test(nextNonSpace)) { current += char; }
      else { if (current.trim()) selectors.push(current.trim()); current = ''; }
    } else { current += char; }
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function isFilePath(arg) {
  if (/\\.(md|markdown)$/i.test(arg)) return true;
  if (existsSync(arg)) return true;
  return false;
}

function partitionArgs(args) {
  const files = [];
  const selectors = [];
  for (const arg of args) {
    if (isFilePath(arg)) { files.push(arg); }
    else { selectors.push(...splitSelectorList(arg)); }
  }
  return { files, selectors };
}

const program = new Command();
program
  .name('mdsel')
  .description(pkg.description + '\\n\\nExamples:\\n  mdsel README.md                 Index document structure\\n  mdsel h2.1 README.md            Select second h2 section\\n  mdsel "*" README.md             Select entire document\\n  mdsel "h2.1/code.0" README.md   Select nested content\\n  mdsel "installation" README.md  Fuzzy search\\n  mdsel --json README.md          Output as JSON')
  .version(pkg.version)
  .option('--json', 'Output JSON instead of text')
  .argument('[args...]', 'Markdown files and selectors (auto-detected)')
  .action(async (args) => {
    try {
      const globalOpts = program.opts();
      if (args.length === 0) {
        if (isStdinPiped()) { await indexCommand([], { json: globalOpts.json }); return; }
        program.outputHelp();
        process.exit(0);
      }
      const { files, selectors } = partitionArgs(args);
      if (files.length === 0) {
        console.error('Error: No markdown files provided.');
        console.error('Usage: mdsel <file.md> [selector...]');
        process.exit(ExitCode.ERROR);
      }
      if (selectors.length === 0) { await indexCommand(files, { json: globalOpts.json }); return; }
      if (selectors.length === 1) { await selectCommand(selectors[0], files, { json: globalOpts.json }); }
      else { await selectMultiCommand(selectors, files, { json: globalOpts.json }); }
    } catch (error) { console.error('Unexpected error:', error); process.exit(ExitCode.ERROR); }
  });

program.command('format')
  .description('Output format specification for tool descriptions')
  .argument('[command]', 'Command to describe')
  .option('--example', 'Show example output')
  .action((command, options) => { formatCommand(command, options); });

program.command('index')
  .description('Index markdown files')
  .argument('<files...>', 'Markdown files to index')
  .action(async (files) => {
    try { const globalOpts = program.opts(); await indexCommand(files, { json: globalOpts.json }); }
    catch (error) { console.error('Unexpected error:', error); process.exit(ExitCode.ERROR); }
  });

program.command('select')
  .description('Select content')
  .argument('<selector>', 'Selector to match')
  .argument('<files...>', 'Markdown files to search')
  .action(async (selector, files) => {
    try {
      const globalOpts = program.opts();
      const selectors = splitSelectorList(selector);
      if (selectors.length === 1) { await selectCommand(selectors[0], files, { json: globalOpts.json }); }
      else { await selectMultiCommand(selectors, files, { json: globalOpts.json }); }
    } catch (error) { console.error('Unexpected error:', error); process.exit(ExitCode.ERROR); }
  });

program.parse();
`

  // Write temporary entry file
  const entryPath = join(mdselSrcDir, "_bundled_entry.ts")
  await Bun.write(entryPath, entryContent)

  try {
    // Bundle with bun
    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir: dirname(outputPath),
      naming: "cli.mjs",
      target: "node",
      format: "esm",
      minify: true,
      sourcemap: "none",
      external: [], // Bundle everything
    })

    if (!result.success) {
      console.error("Build failed:")
      for (const log of result.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    // Check output size
    const outputFile = Bun.file(outputPath)
    const size = outputFile.size
    console.log(`✓ Bundle created: ${outputPath}`)
    console.log(`  Size: ${(size / 1024).toFixed(2)} KB`)

    if (size > 100 * 1024) {
      console.warn(`⚠ Warning: Bundle size exceeds 100KB`)
    }
  } finally {
    // Cleanup temp entry file
    const { unlink } = await import("fs/promises")
    await unlink(entryPath).catch(() => {})
  }
}

main().catch((err) => {
  console.error("Build error:", err)
  process.exit(1)
})
