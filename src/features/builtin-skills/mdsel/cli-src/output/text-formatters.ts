/**
 * Minimal text formatters for CLI output.
 *
 * Designed to minimize token consumption for LLM agents.
 * Format: plain text with strategic whitespace, no JSON overhead.
 *
 * @module output/text-formatters
 */

import type {
  DocumentIndex,
  HeadingDescriptor,
  SelectMatch,
  UnresolvedSelector,
  ErrorEntry,
} from './types.js';

/**
 * Format index response as minimal text.
 *
 * Output format:
 * ```
 * namespace filepath
 * h1[0] Title
 * h2[0] Section
 *  h3[0] Subsection
 * ---
 * code:N para:N list:N table:N
 * ```
 */
export function formatIndexText(documents: DocumentIndex[]): string {
  const parts: string[] = [];
  const multiDoc = documents.length > 1;

  for (const doc of documents) {
    // Header line only for multi-doc
    if (multiDoc) {
      parts.push(`${doc.namespace} ${doc.file_path}`);
    }

    // Build heading tree with indentation
    const headingLines = formatHeadingTree(doc.headings);
    if (headingLines.length > 0) {
      parts.push(...headingLines);
    }

    // Block summary
    const blocks = doc.blocks;
    const blockParts: string[] = [];
    if (blocks.code_blocks > 0) blockParts.push(`code:${blocks.code_blocks}`);
    if (blocks.paragraphs > 0) blockParts.push(`para:${blocks.paragraphs}`);
    if (blocks.lists > 0) blockParts.push(`list:${blocks.lists}`);
    if (blocks.tables > 0) blockParts.push(`table:${blocks.tables}`);
    if (blocks.blockquotes > 0) blockParts.push(`quote:${blocks.blockquotes}`);

    if (blockParts.length > 0) {
      parts.push('---');
      parts.push(blockParts.join(' '));
    }
  }

  return parts.join('\n');
}

/**
 * Format headings as indented tree with .N index syntax.
 */
function formatHeadingTree(headings: HeadingDescriptor[]): string[] {
  const lines: string[] = [];
  const counts: Record<number, number> = {}; // count per depth level

  for (const h of headings) {
    const idx = counts[h.depth] ?? 0;
    counts[h.depth] = idx + 1;

    // Indent by depth: h1=0, h2=1 space, h3=2 spaces, etc.
    const indent = h.depth > 1 ? ' '.repeat(h.depth - 1) : '';
    lines.push(`${indent}h${h.depth}.${idx} ${h.text}`);
  }

  return lines;
}

/**
 * Format select response as minimal text.
 *
 * Output format (success):
 * ```
 * content here
 * ---
 * /child[0] /child[1]
 * ```
 *
 * Output format (error):
 * ```
 * !selector
 * reason
 * ~suggestion1 ~suggestion2
 * ```
 */
export function formatSelectText(
  matches: SelectMatch[],
  unresolved: UnresolvedSelector[],
): string {
  const parts: string[] = [];

  // Format matches - use selector as prefix for multiple results
  for (let i = 0; i < matches.length; i++) {
    if (matches.length > 1) parts.push(`${matches[i].selector}:`);
    parts.push(matches[i].content);
  }

  // Format unresolved selectors
  for (const u of unresolved) {
    parts.push(`!${u.selector}`);
    parts.push(u.reason);
    if (u.suggestions.length > 0) {
      // Show suggestions with ~ prefix, limit to 5
      const suggestions = u.suggestions.slice(0, 5).map((s) => `~${s}`).join(' ');
      parts.push(suggestions);
    }
  }

  return parts.join('\n');
}

/**
 * Format error response as minimal text.
 *
 * Output format:
 * ```
 * !ERROR_TYPE: message
 * file: path (if applicable)
 * ```
 */
export function formatErrorText(errors: ErrorEntry[]): string {
  const parts: string[] = [];

  for (const err of errors) {
    parts.push(`!${err.type}: ${err.message}`);
    if (err.file) {
      parts.push(`file: ${err.file}`);
    }
    if (err.selector) {
      parts.push(`selector: ${err.selector}`);
    }
    if (err.suggestions && err.suggestions.length > 0) {
      const suggestions = err.suggestions.slice(0, 5).map((s) => `~${s}`).join(' ');
      parts.push(suggestions);
    }
  }

  return parts.join('\n');
}

/**
 * Format specification strings for the `format` command.
 */
export const FORMAT_SPECS = {
  index: {
    terse: 'hN.I title (indented)\\n---\\ncode:N para:N list:N table:N',
    example: `h1.0 mdsel
 h2.0 Installation
 h2.1 Quick Start
 h2.2 Commands
  h3.0 index
  h3.1 select
---
code:19 para:23 list:5 table:3`,
  },
  select: {
    terse: 'content only. multiple: selector: prefix. no index = all',
    example: `h2.0:
## Installation
content...
h2.1:
## Quick Start
content...

# single result: no prefix
## Installation
content...

# error format
!selector
reason
~suggestion1 ~suggestion2`,
  },
};
