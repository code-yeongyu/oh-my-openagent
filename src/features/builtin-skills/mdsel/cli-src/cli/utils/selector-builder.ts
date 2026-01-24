/**
 * Selector building utilities for CLI.
 *
 * Provides functions for building available selectors and document indices
 * from mdast trees for use in index command output.
 *
 * @module cli/utils/selector-builder
 */

import type { Root, RootContent } from 'mdast';
import type {
  DocumentIndex,
  HeadingDescriptor,
  NodeDescriptor,
  BlockSummary,
} from '../../output/types.js';
import { extractText, countWords, getContentPreview } from './content-extractor.js';

/**
 * Build list of available selectors for a document.
 *
 * Traverses the tree and collects all valid selector paths for
 * suggestion generation and reference.
 *
 * @param tree - The mdast tree
 * @param namespace - The document namespace
 * @returns Array of available selector strings
 *
 * @example
 * ```typescript
 * const selectors = buildAvailableSelectors(tree, 'readme');
 * // ['readme::root', 'readme::heading:h1[0]', 'readme::heading:h2[0]', ...]
 * ```
 */
export function buildAvailableSelectors(tree: Root, namespace: string): string[] {
  const selectors: string[] = [];
  const headingCounts: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };
  const blockCounts: Record<string, number> = {
    paragraph: 0,
    code: 0,
    list: 0,
    table: 0,
    blockquote: 0,
  };

  // Add root selector
  selectors.push(`${namespace}::root`);

  // Traverse children
  for (const child of tree.children) {
    if (child.type === 'heading') {
      const depth = child.depth;
      const currentIndex = headingCounts[depth] ?? 0;
      headingCounts[depth] = currentIndex + 1;
      selectors.push(`${namespace}::heading:h${String(depth)}[${String(currentIndex)}]`);
    } else {
      const blockType = mapNodeTypeToBlockType(child.type);
      if (blockType) {
        const currentIndex = blockCounts[blockType] ?? 0;
        blockCounts[blockType] = currentIndex + 1;
        selectors.push(`${namespace}::block:${blockType}[${String(currentIndex)}]`);
      }
    }
  }

  return selectors;
}

/**
 * Build document index for index command output.
 *
 * Creates a DocumentIndex with heading descriptors, block summary,
 * and optional root descriptor.
 *
 * @param tree - The mdast tree
 * @param namespace - The document namespace
 * @param filePath - The file path
 * @returns Document index
 *
 * @example
 * ```typescript
 * const index = buildDocumentIndex(tree, 'readme', 'README.md');
 * // {
 * //   namespace: 'readme',
 * //   file_path: 'README.md',
 * //   root: { ... },
 * //   headings: [ ... ],
 * //   blocks: { ... }
 * // }
 * ```
 */
export function buildDocumentIndex(tree: Root, namespace: string, filePath: string): DocumentIndex {
  const headings: HeadingDescriptor[] = [];
  const blockCounts: BlockSummary = {
    paragraphs: 0,
    code_blocks: 0,
    lists: 0,
    tables: 0,
    blockquotes: 0,
  };

  const headingIndices: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };

  // Process root content (before first heading)
  let root: NodeDescriptor | null = null;
  const preHeadingContent: RootContent[] = [];
  let foundHeading = false;

  for (const child of tree.children) {
    if (child.type === 'heading') {
      foundHeading = true;
      const heading = child;
      const depth = heading.depth;
      const currentIndex = headingIndices[depth] ?? 0;
      headingIndices[depth] = currentIndex + 1;
      const text = extractText(heading);

      // Count children in this heading's section
      let childrenCount = 0;
      let i = tree.children.indexOf(heading) + 1;
      while (i < tree.children.length) {
        const nextChild = tree.children[i];
        if (nextChild?.type === 'heading' && nextChild.depth <= depth) {
          break;
        }
        childrenCount++;
        i++;
      }

      headings.push({
        selector: `${namespace}::heading:h${String(depth)}[${String(currentIndex)}]`,
        type: `heading:h${String(depth)}`,
        depth,
        text,
        content_preview: getContentPreview(text),
        truncated: false,
        children_count: childrenCount,
        word_count: countWords(text),
        section_word_count: countWords(text), // Simplified - just heading text
        section_truncated: false,
      });
    } else {
      if (!foundHeading) {
        preHeadingContent.push(child);
      }
      // Count blocks
      countBlock(child, blockCounts);
    }
  }

  // Build root descriptor if there's pre-heading content
  if (preHeadingContent.length > 0) {
    const rootText = preHeadingContent.map((c) => extractText(c)).join('\n');
    root = {
      selector: `${namespace}::root`,
      type: 'root',
      content_preview: getContentPreview(rootText),
      truncated: false,
      children_count: preHeadingContent.length,
      word_count: countWords(rootText),
    };
  }

  return {
    namespace,
    file_path: filePath,
    root,
    headings,
    blocks: blockCounts,
  };
}

/**
 * Map mdast node type to block type string.
 */
function mapNodeTypeToBlockType(type: string): string | null {
  switch (type) {
    case 'paragraph':
      return 'paragraph';
    case 'code':
      return 'code';
    case 'list':
      return 'list';
    case 'table':
      return 'table';
    case 'blockquote':
      return 'blockquote';
    default:
      return null;
  }
}

/**
 * Count a block node in the block summary.
 */
function countBlock(node: RootContent, counts: BlockSummary): void {
  switch (node.type) {
    case 'paragraph':
      counts.paragraphs++;
      break;
    case 'code':
      counts.code_blocks++;
      break;
    case 'list':
      counts.lists++;
      break;
    case 'table':
      counts.tables++;
      break;
    case 'blockquote':
      counts.blockquotes++;
      break;
  }
}
