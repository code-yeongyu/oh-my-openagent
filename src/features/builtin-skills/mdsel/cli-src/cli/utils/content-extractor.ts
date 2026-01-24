/**
 * Content extraction utilities for CLI.
 *
 * Provides functions for extracting markdown and text content from mdast nodes,
 * with support for truncation and word counting.
 *
 * @module cli/utils/content-extractor
 */

import { toString } from 'mdast-util-to-string';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import type { Root, RootContent } from 'mdast';

/** Default preview length in characters */
const PREVIEW_LENGTH = 80;

/** Truncation marker appended to truncated content */
const TRUNCATION_MARKER = '[truncated]';

/**
 * Content node type (Root or any RootContent node).
 */
export type ContentNode = Root | RootContent;

/**
 * Result of content truncation.
 */
export interface TruncatedContent {
  /** The content (possibly truncated) */
  content: string;
  /** Whether the content was truncated */
  truncated: boolean;
  /** Word count of the returned content */
  wordCount: number;
}

/**
 * Extract markdown string from an mdast node.
 *
 * Handles synthetic section nodes by wrapping children in a root.
 *
 * @param node - The mdast node to convert
 * @returns Markdown string with trailing whitespace trimmed
 *
 * @example
 * ```typescript
 * const md = extractMarkdown(headingNode);
 * // "## Installation"
 * ```
 */
export function extractMarkdown(node: ContentNode | SectionNode): string {
  // Handle synthetic section nodes created by heading selector
  if (isSectionNode(node)) {
    const root: Root = { type: 'root', children: node.children };
    return toMarkdown(root, { extensions: [gfmToMarkdown()] }).trimEnd();
  }
  return toMarkdown(node, { extensions: [gfmToMarkdown()] }).trimEnd();
}

/**
 * Synthetic section node type (heading + content below it).
 */
interface SectionNode {
  type: 'section';
  depth: number;
  children: RootContent[];
  position?: unknown;
}

function isSectionNode(node: unknown): node is SectionNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    (node as { type: unknown }).type === 'section' &&
    'children' in node
  );
}

/**
 * Extract plain text from an mdast node.
 *
 * @param node - The mdast node to convert
 * @returns Plain text content
 *
 * @example
 * ```typescript
 * const text = extractText(headingNode);
 * // "Installation"
 * ```
 */
export function extractText(node: ContentNode): string {
  return toString(node);
}

/**
 * Count words in text using whitespace splitting.
 *
 * @param text - The text to count words in
 * @returns Word count
 *
 * @example
 * ```typescript
 * countWords("Hello world");  // 2
 * countWords("");             // 0
 * countWords("  ");           // 0
 * ```
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Get a content preview truncated to max length.
 *
 * @param text - The text to preview
 * @param maxLen - Maximum length (default: 80)
 * @returns Truncated preview with "..." if needed
 *
 * @example
 * ```typescript
 * getContentPreview("Short text");           // "Short text"
 * getContentPreview("Very long text...", 10); // "Very long ..."
 * ```
 */
export function getContentPreview(text: string, maxLen: number = PREVIEW_LENGTH): string {
  // Normalize whitespace - replace newlines and multiple spaces with single space
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen) + '...';
}

/**
 * Options for truncating content.
 */
export interface TruncateOptions {
  /** Return only the first N lines */
  head?: number;
  /** Return only the last N lines */
  tail?: number;
}

/**
 * Truncate content by line count.
 *
 * By default returns full content. Use head or tail to limit output.
 *
 * @param content - The content to potentially truncate
 * @param options - Options for head/tail truncation
 * @returns Truncated content result
 *
 * @example
 * ```typescript
 * // Full content (default)
 * truncateContent(longContent);
 * // { content: "All content...", truncated: false, wordCount: 1500 }
 *
 * // First 10 lines
 * truncateContent(longContent, { head: 10 });
 * // { content: "First 10 lines...\n[truncated]", truncated: true, wordCount: ... }
 *
 * // Last 5 lines
 * truncateContent(longContent, { tail: 5 });
 * // { content: "[truncated]\nLast 5 lines...", truncated: true, wordCount: ... }
 * ```
 */
export function truncateContent(
  content: string,
  options: TruncateOptions = {},
): TruncatedContent {
  const lines = content.split('\n');
  const totalLines = lines.length;

  // Head truncation: return first N lines
  if (options.head !== undefined && options.head > 0) {
    if (options.head >= totalLines) {
      return { content, truncated: false, wordCount: countWords(content) };
    }
    const truncatedLines = lines.slice(0, options.head);
    const truncatedContent = truncatedLines.join('\n') + '\n' + TRUNCATION_MARKER;
    return {
      content: truncatedContent,
      truncated: true,
      wordCount: countWords(truncatedContent),
    };
  }

  // Tail truncation: return last N lines
  if (options.tail !== undefined && options.tail > 0) {
    if (options.tail >= totalLines) {
      return { content, truncated: false, wordCount: countWords(content) };
    }
    const truncatedLines = lines.slice(-options.tail);
    const truncatedContent = TRUNCATION_MARKER + '\n' + truncatedLines.join('\n');
    return {
      content: truncatedContent,
      truncated: true,
      wordCount: countWords(truncatedContent),
    };
  }

  // Default: return full content
  return { content, truncated: false, wordCount: countWords(content) };
}
