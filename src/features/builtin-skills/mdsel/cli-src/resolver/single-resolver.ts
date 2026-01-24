/* eslint-disable */
import type { Root } from 'mdast';
import type { SelectorAST, PathSegmentNode } from '../selector/types.js';
import type {
  ResolutionOutcome,
  ResolutionFailure,
  ResolutionResult,
  ResolutionError,
  ResolutionContext,
} from './types.js';
import { SuggestionEngine } from './suggestions.js';
import { DEFAULT_MAX_DEPTH } from '../utils/validation.js';

/**
 * Internal result type for path segment resolution.
 */
interface SegmentResolutionSuccess {
  success: true;
  nodes: Array<{ node: any; path: any[] }>; // Multiple nodes when no index specified
}

interface SegmentResolutionFailure {
  success: false;
  errorType: ResolutionError['type'];
  errorMessage: string;
  failedAtSegment: number;
  partialResults?: ResolutionResult[];
}

type SegmentResolutionOutcome = SegmentResolutionSuccess | SegmentResolutionFailure;

/**
 * Resolve a selector against a single document tree.
 *
 * Traverses the mdast tree left-to-right, matching each path segment
 * against nodes in the tree. Index selection is 0-based and scoped
 * to nodes of the same type within the current context.
 *
 * @param tree - The mdast tree
 * @param namespace - Document namespace (e.g., filename without extension)
 * @param selector - The parsed selector AST
 * @param availableSelectors - All available selectors in this document (for suggestions)
 * @returns Resolution outcome (success or error)
 *
 * @example
 * ```typescript
 * const { ast } = parseMarkdown('# Hello\\n\\nWorld');
 * const selector = parseSelector('heading:h1[0]');
 * const result = resolveSingle(ast, 'doc', selector, ['doc::heading:h1[0]']);
 * if (result.success) {
 *   console.log(result.results[0].node); // The heading node
 * }
 * ```
 */
export function resolveSingle(
  tree: Root,
  namespace: string,
  selector: SelectorAST,
  availableSelectors: string[],
): ResolutionOutcome {
  try {
    // Check namespace match
    if (selector.namespace && selector.namespace !== namespace) {
      return createNamespaceError(selector, [namespace], availableSelectors);
    }

    // Start resolution from root
    const context: ResolutionContext = {
      namespace,
      path: [],
      currentNode: tree,
      segmentIndex: 0,
      totalSegments: selector.segments.length,
    };

    const result = resolvePathSegments(context, selector.segments);

    if (result.success) {
      // Get actual indices from the selector's last segment
      const lastSeg = selector.segments[selector.segments.length - 1];
      const indices = Array.isArray(lastSeg?.index) ? lastSeg.index : undefined;

      // Build results for all matched nodes
      const results: ResolutionResult[] = result.nodes.map(({ node, path }, idx) => ({
        namespace,
        node,
        selector: selectorToString(selector, indices?.[idx]),
        path,
        wordCount: estimateWordCount(node),
        childrenAvailable: hasChildren(node),
      }));

      return {
        success: true,
        results,
      };
    } else {
      // Generate suggestions for failed resolution
      const engine = new SuggestionEngine(availableSelectors);
      const suggestions = engine.getSuggestions(selectorToString(selector));

      const error: ResolutionError = {
        type: result.errorType,
        message: result.errorMessage,
        selector: selectorToString(selector),
        suggestions,
      };

      // Add failed segment if available
      const failedSegment = selector.segments[result.failedAtSegment];
      if (failedSegment) {
        error.failedSegment = failedSegment;
      }

      return {
        success: false,
        error,
        partialResults: result.partialResults,
      };
    }
  } catch (error) {
    const errorOut: ResolutionError = {
      type: 'INVALID_PATH',
      message: error instanceof Error ? error.message : 'Unknown error',
      selector: selectorToString(selector),
      suggestions: [],
    };

    return {
      success: false,
      error: errorOut,
    };
  }
}

/**
 * Resolve path segments against the tree.
 *
 * Processes each segment sequentially, narrowing the search scope
 * with each successful match. When no index is specified on the final
 * segment, returns ALL matches.
 */
function resolvePathSegments(
  context: ResolutionContext,
  segments: PathSegmentNode[],
): SegmentResolutionOutcome {
  let currentNodes: Array<{ node: any; path: any[] }> = [{ node: context.currentNode, path: [...context.path] }];
  const partialResults: ResolutionResult[] = [];
  const maxDepth = DEFAULT_MAX_DEPTH;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) {
      return {
        success: false,
        errorType: 'SELECTOR_NOT_FOUND',
        errorMessage: `Invalid segment at index ${i}`,
        failedAtSegment: i,
      };
    }
    context.segmentIndex = i;
    const isLastSegment = i === segments.length - 1;

    // Check depth limit before processing segment
    if (i >= maxDepth) {
      return {
        success: false,
        errorType: 'SELECTOR_NOT_FOUND',
        errorMessage: `Selector depth ${i + 1} exceeds maximum of ${maxDepth}`,
        failedAtSegment: i,
        partialResults,
      };
    }

    // Handle root segment specially
    if (segment.nodeType === 'root') {
      // Root is the starting point - don't search, validate and continue
      if (currentNodes[0]?.node.type !== 'root') {
        return {
          success: false,
          errorType: 'SELECTOR_NOT_FOUND',
          errorMessage: 'Root segment can only be used at the beginning',
          failedAtSegment: i,
        };
      }
      // Root matches the current node, continue to next segment
      currentNodes = currentNodes.map(({ node, path }) => ({ node, path: [...path, node] }));
      continue;
    }

    // Handle wildcard (*) - returns entire document
    if (segment.nodeType === 'all') {
      // The wildcard returns the root node (entire document)
      currentNodes = currentNodes.map(({ node, path }) => ({ node, path: [...path, node] }));
      continue;
    }

    // Find matching children for current segment (from first current node)
    const currentNode = currentNodes[0]?.node;
    const currentPath = currentNodes[0]?.path ?? [];
    const matches = findMatchingChildren(currentNode, segment);

    if (matches.length === 0) {
      return {
        success: false,
        errorType: 'SELECTOR_NOT_FOUND',
        errorMessage: `No matches found for segment at index ${i}`,
        failedAtSegment: i,
        partialResults,
      };
    }

    // Apply index if specified, otherwise return all on last segment
    if (segment.index !== undefined) {
      const indices = Array.isArray(segment.index) ? segment.index : [segment.index];

      // Validate all indices are in range
      const maxIndex = Math.max(...indices);
      if (maxIndex >= matches.length) {
        const subtype = segment.subtype ? ':' + segment.subtype : '';
        return {
          success: false,
          errorType: 'INDEX_OUT_OF_RANGE',
          errorMessage: `Index ${maxIndex} out of range (only ${matches.length} ${segment.nodeType}${subtype}(s) found)`,
          failedAtSegment: i,
          partialResults,
        };
      }

      // Select all specified indices
      currentNodes = indices.map((idx) => {
        const selected = matches[idx];
        return { node: selected, path: [...currentPath, selected] };
      });
    } else if (isLastSegment) {
      // No index on last segment: return ALL matches
      currentNodes = matches.map((m) => ({ node: m, path: [...currentPath, m] }));
    } else {
      // No index on intermediate segment: default to first
      currentNodes = [{ node: matches[0], path: [...currentPath, matches[0]] }];
    }

    // Track partial results for error recovery
    partialResults.push({
      namespace: context.namespace,
      node: currentNodes[0]?.node,
      selector: segmentToString(segment),
      path: currentNodes[0]?.path ?? [],
      wordCount: estimateWordCount(currentNodes[0]?.node),
      childrenAvailable: hasChildren(currentNodes[0]?.node),
    });
  }

  return {
    success: true,
    nodes: currentNodes,
  };
}

/**
 * Find children matching a path segment.
 *
 * Returns an array of matching nodes, indexed by their position
 * among siblings of the same type.
 *
 * For headings, returns synthetic section nodes containing the heading
 * and all content until the next heading of equal or higher level.
 */
function findMatchingChildren(parent: any, segment: PathSegmentNode): any[] {
  if (!parent?.children || !Array.isArray(parent.children)) {
    return [];
  }

  const matches: any[] = [];

  switch (segment.nodeType) {
    case 'heading':
      // Match heading by level (depth) and extract section content
      if (segment.subtype?.startsWith('h')) {
        const depth = parseInt(segment.subtype.slice(1), 10);
        const children = parent.children;

        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.type === 'heading' && child.depth === depth) {
            // Build section: heading + content until next heading of same/higher level
            const sectionChildren: any[] = [child];

            for (let j = i + 1; j < children.length; j++) {
              const sibling = children[j];
              // Stop at heading of same or higher level (lower depth number)
              if (sibling.type === 'heading' && sibling.depth <= depth) {
                break;
              }
              sectionChildren.push(sibling);
            }

            // Return synthetic section node
            matches.push({
              type: 'section',
              depth,
              children: sectionChildren,
              position: child.position,
            });
          }
        }
      }
      break;

    case 'section':
    case 'page':
      // Virtual nodes not in mdast - would require semantic tree builder
      // For now, return empty - these will fail with suggestions
      break;

    case 'block':
      // Match by block type (direct mdast type mapping)
      if (segment.subtype) {
        for (const child of parent.children) {
          if (child.type === segment.subtype) {
            matches.push(child);
          }
        }
      }
      break;
  }

  return matches;
}

/**
 * Estimate word count for a node.
 *
 * Extracts text content and splits by whitespace.
 * For code nodes, counts the code content.
 * For container nodes, recursively counts descendant text.
 */
function estimateWordCount(node: any): number {
  if (!node) return 0;

  // Handle nodes with direct value (text, code, inline code)
  if (node.value && typeof node.value === 'string') {
    return node.value
      .trim()
      .split(/\s+/)
      .filter((w: string) => w.length > 0).length;
  }

  // Handle nodes with children (container nodes)
  if (node.children && Array.isArray(node.children)) {
    let count = 0;
    for (const child of node.children) {
      count += estimateWordCount(child);
    }
    return count;
  }

  return 0;
}

/**
 * Check if node has children available for further selection.
 */
function hasChildren(node: any): boolean {
  return node?.children && Array.isArray(node.children) && node.children.length > 0;
}

/**
 * Convert selector AST back to string (for error messages).
 * If resultIndex is provided, overrides the last segment's index.
 */
function selectorToString(selector: SelectorAST, resultIndex?: number): string {
  let result = '';

  if (selector.namespace) {
    result += `${selector.namespace}::`;
  }

  result += selector.segments.map((seg, i) => {
    const isLast = i === selector.segments.length - 1;
    // If resultIndex provided, use it for the last segment instead of the segment's index
    if (isLast && resultIndex !== undefined) {
      return segmentToStringWithIndex(seg, resultIndex);
    }
    return segmentToString(seg);
  }).join('/');

  if (selector.queryParams && selector.queryParams.length > 0) {
    const params = selector.queryParams.map((p) => `${p.key}=${p.value}`).join('&');
    result += `?${params}`;
  }

  return result;
}

/**
 * Convert segment to string with a specific index override.
 */
function segmentToStringWithIndex(segment: PathSegmentNode, index: number): string {
  let segStr = segment.nodeType;
  if (segment.subtype) {
    segStr += `:${segment.subtype}`;
  }
  segStr += `.${index}`;
  return segStr;
}

/**
 * Convert single path segment to string.
 * Handles both single indices and index arrays.
 */
function segmentToString(segment: PathSegmentNode): string {
  // Handle wildcard specially
  if (segment.nodeType === 'all') {
    return '*';
  }
  let segStr = segment.nodeType;
  if (segment.subtype) {
    segStr += `:${segment.subtype}`;
  }
  if (segment.index !== undefined) {
    const idx = segment.index;
    if (Array.isArray(idx)) {
      segStr += `.${idx.join(',')}`;
    } else {
      segStr += `.${idx}`;
    }
  }
  return segStr;
}

/**
 * Create namespace error outcome with suggestions.
 */
function createNamespaceError(
  selector: SelectorAST,
  availableNamespaces: string[],
  availableSelectors: string[],
): ResolutionFailure {
  // Generate namespace suggestions
  const engine = new SuggestionEngine(availableNamespaces);
  const nsSuggestions = engine.getSuggestions(selector.namespace || '');

  const suggestions = nsSuggestions.map((s) => ({
    selector: `${s.selector}::${selectorToString(selector).replace(/^[^:]+::/, '')}`,
    distance: s.distance,
    ratio: s.ratio,
    reason: s.reason,
  }));

  return {
    success: false,
    error: {
      type: 'NAMESPACE_NOT_FOUND',
      message: `Namespace '${selector.namespace}' not found. Available namespaces: ${availableNamespaces.join(', ')}`,
      selector: selectorToString(selector),
      suggestions,
    },
  };
}
