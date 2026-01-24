/**
 * Fuzzy search module for finding content in markdown documents.
 *
 * When a selector fails to parse, this module allows treating the input
 * as a search query to find matching sections.
 *
 * @module resolver/search
 */

import type { Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import { levenshteinDistance } from './levenshtein.js';

/**
 * A search result containing the selector and matched content.
 */
export interface SearchResult {
  /** The selector path to this content */
  selector: string;
  /** The type of node (heading, paragraph, code, etc.) */
  type: string;
  /** Preview of the matched content */
  preview: string;
  /** The full content of the matched section */
  content: string;
  /** The search relevance score (0-1, higher is better) */
  score: number;
  /** How the match was found */
  matchType: 'exact' | 'substring' | 'fuzzy';
}

/**
 * Options for the search function.
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 10) */
  maxResults?: number;
  /** Minimum score threshold (0-1, default: 0.3) */
  minScore?: number;
  /** Whether to search in code blocks (default: true) */
  includeCode?: boolean;
}

/**
 * Search for content in a document tree.
 *
 * Performs fuzzy matching against headings, paragraphs, code blocks,
 * and other content. Returns selectors for matching sections.
 *
 * @param tree - The mdast document tree
 * @param namespace - Document namespace for selector prefixes
 * @param query - The search query
 * @param options - Search options
 * @returns Array of search results sorted by relevance
 */
export function searchDocument(
  tree: Root,
  namespace: string,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const { maxResults = 10, minScore = 0.3, includeCode = true } = options;
  const results: SearchResult[] = [];
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return [];
  }

  // Track indices for each type
  const headingIndices: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const blockIndices: Record<string, number> = {
    paragraph: 0,
    code: 0,
    list: 0,
    table: 0,
    blockquote: 0,
  };

  // Traverse document
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (!node) continue;

    const nodeType = node.type;
    const text = toString(node);
    const normalizedText = text.toLowerCase();

    // Calculate match score
    const matchResult = calculateMatchScore(normalizedQuery, normalizedText, text);

    if (matchResult.score >= minScore) {
      let selector: string;
      let type: string;

      if (nodeType === 'heading' && 'depth' in node) {
        const depth = node.depth as number;
        const idx = headingIndices[depth] ?? 0;
        selector = `${namespace}::h${depth}.${idx}`;
        type = `heading:h${depth}`;
        headingIndices[depth] = idx + 1;
      } else if (nodeType in blockIndices) {
        const idx = blockIndices[nodeType] ?? 0;
        const shorthand = getBlockShorthand(nodeType);
        selector = `${namespace}::${shorthand}.${idx}`;
        type = nodeType;
        blockIndices[nodeType] = idx + 1;

        // Skip code blocks if not included
        if (nodeType === 'code' && !includeCode) {
          continue;
        }
      } else {
        // Skip non-selectable nodes
        continue;
      }

      results.push({
        selector,
        type,
        preview: createPreview(text, normalizedQuery, 100),
        content: text,
        score: matchResult.score,
        matchType: matchResult.matchType,
      });
    } else {
      // Still need to track indices even if not matching
      if (nodeType === 'heading' && 'depth' in node) {
        const depth = node.depth as number;
        headingIndices[depth] = (headingIndices[depth] ?? 0) + 1;
      } else if (nodeType in blockIndices) {
        blockIndices[nodeType] = (blockIndices[nodeType] ?? 0) + 1;
      }
    }
  }

  // Also search within heading sections (heading + content until next heading)
  const sectionResults = searchHeadingSections(tree, namespace, normalizedQuery, minScore);
  results.push(...sectionResults);

  // Sort by score (descending) and limit results
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Search within heading sections (heading + all content until next same-level heading).
 */
function searchHeadingSections(
  tree: Root,
  namespace: string,
  normalizedQuery: string,
  minScore: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const headingIndices: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (!node || node.type !== 'heading' || !('depth' in node)) {
      continue;
    }

    const depth = node.depth as number;
    const idx = headingIndices[depth] ?? 0;
    headingIndices[depth] = idx + 1;

    // Build section content (heading + following content until next same/higher level heading)
    const sectionParts: string[] = [toString(node)];
    for (let j = i + 1; j < tree.children.length; j++) {
      const sibling = tree.children[j];
      if (!sibling) break;
      if (sibling.type === 'heading' && 'depth' in sibling && sibling.depth <= depth) {
        break;
      }
      sectionParts.push(toString(sibling));
    }

    const sectionText = sectionParts.join('\n');
    const normalizedSection = sectionText.toLowerCase();

    // Check if query matches within section content (not just heading)
    const matchResult = calculateMatchScore(normalizedQuery, normalizedSection, sectionText);

    if (matchResult.score >= minScore) {
      const selector = `${namespace}::h${depth}.${idx}`;

      // Check if we already have this selector from individual node search
      const existing = results.find((r) => r.selector === selector);
      if (!existing) {
        results.push({
          selector,
          type: `heading:h${depth}`,
          preview: createPreview(sectionText, normalizedQuery, 100),
          content: sectionText,
          score: matchResult.score * 0.9, // Slightly lower score for section matches
          matchType: matchResult.matchType,
        });
      }
    }
  }

  return results;
}

/**
 * Calculate match score between query and text.
 */
function calculateMatchScore(
  normalizedQuery: string,
  normalizedText: string,
  originalText: string,
): { score: number; matchType: 'exact' | 'substring' | 'fuzzy' } {
  // Exact match (case-insensitive)
  if (normalizedText === normalizedQuery) {
    return { score: 1.0, matchType: 'exact' };
  }

  // Substring match
  if (normalizedText.includes(normalizedQuery)) {
    // Score based on how much of the text the query covers
    const coverage = normalizedQuery.length / normalizedText.length;
    const score = 0.7 + coverage * 0.25; // 0.7-0.95 range
    return { score, matchType: 'substring' };
  }

  // Word-level matching
  const queryWords = normalizedQuery.split(/\s+/).filter((w) => w.length > 0);
  const textWords = normalizedText.split(/\s+/).filter((w) => w.length > 0);

  if (queryWords.length > 0) {
    let matchedWords = 0;
    for (const queryWord of queryWords) {
      // Check for exact word match or fuzzy word match
      for (const textWord of textWords) {
        if (textWord === queryWord) {
          matchedWords++;
          break;
        }
        if (textWord.includes(queryWord) || queryWord.includes(textWord)) {
          matchedWords += 0.7;
          break;
        }
        // Fuzzy match on individual words
        const distance = levenshteinDistance(queryWord, textWord);
        const maxLen = Math.max(queryWord.length, textWord.length);
        const similarity = (maxLen - distance) / maxLen;
        if (similarity > 0.7) {
          matchedWords += similarity * 0.5;
          break;
        }
      }
    }

    const wordMatchRatio = matchedWords / queryWords.length;
    if (wordMatchRatio > 0.3) {
      return { score: wordMatchRatio * 0.6, matchType: 'fuzzy' };
    }
  }

  // No significant match
  return { score: 0, matchType: 'fuzzy' };
}

/**
 * Create a preview snippet highlighting where the match occurred.
 */
function createPreview(text: string, query: string, maxLength: number): string {
  const normalizedText = text.toLowerCase();
  const index = normalizedText.indexOf(query);

  if (index === -1) {
    // No exact match, just return start of text
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    return cleaned.slice(0, maxLength - 3) + '...';
  }

  // Center the preview around the match
  const start = Math.max(0, index - Math.floor((maxLength - query.length) / 2));
  const end = Math.min(text.length, start + maxLength);

  let preview = text.slice(start, end).replace(/\s+/g, ' ');

  if (start > 0) {
    preview = '...' + preview;
  }
  if (end < text.length) {
    preview = preview + '...';
  }

  return preview.trim();
}

/**
 * Get the shorthand selector name for a block type.
 */
function getBlockShorthand(type: string): string {
  switch (type) {
    case 'paragraph':
      return 'para';
    case 'blockquote':
      return 'quote';
    default:
      return type;
  }
}

/**
 * Search across multiple documents.
 */
export function searchMultipleDocuments(
  documents: Array<{ tree: Root; namespace: string }>,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const allResults: SearchResult[] = [];

  for (const doc of documents) {
    const docResults = searchDocument(doc.tree, doc.namespace, query, options);
    allResults.push(...docResults);
  }

  // Sort all results by score and limit
  const maxResults = options.maxResults ?? 10;
  return allResults.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
