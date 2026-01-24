/* eslint-disable */
import type { Root } from 'mdast';
import type { PathSegmentNode } from '../selector/types.js';

/**
 * Resolution result for a successful selector match.
 */
export interface ResolutionResult {
  /** The namespace of the document where the match was found */
  namespace: string;
  /** The matched node from the mdast tree */
  node: any;
  /** The selector that was resolved (for reference) */
  selector: string;
  /** Full path to the matched node (if available) */
  path: any[];
  /** Approximate word count of the matched node's content */
  wordCount: number;
  /** Whether child nodes are available for further selection */
  childrenAvailable: boolean;
}

/**
 * Resolution error for failed selector resolution.
 */
export interface ResolutionError {
  /** Error type code */
  type: 'NAMESPACE_NOT_FOUND' | 'SELECTOR_NOT_FOUND' | 'INVALID_PATH' | 'INDEX_OUT_OF_RANGE';
  /** Human-readable error message */
  message: string;
  /** The selector that failed */
  selector: string;
  /** Position in the selector where resolution failed (if known) */
  failedSegment?: PathSegmentNode;
  /** Suggested alternatives (if available) */
  suggestions: Suggestion[];
}

/**
 * Suggestion for correcting a failed selector.
 */
export interface Suggestion {
  /** Suggested selector string */
  selector: string;
  /** Edit distance from original query */
  distance: number;
  /** Similarity ratio (0-1, higher is better) */
  ratio: number;
  /** Explanation of why this was suggested */
  reason: 'exact_match' | 'fuzzy_match' | 'typo_correction' | 'index_adjustment';
}

/**
 * Successful resolution outcome.
 */
export interface ResolutionSuccess {
  success: true;
  results: ResolutionResult[];
}

/**
 * Failed resolution outcome.
 */
export interface ResolutionFailure {
  success: false;
  error: ResolutionError;
  /** Partial results if some segments matched */
  partialResults?: ResolutionResult[];
}

/**
 * Combined resolution outcome (success or error).
 */
export type ResolutionOutcome = ResolutionSuccess | ResolutionFailure;

/**
 * Document tree with namespace for multi-document resolution.
 */
export interface DocumentTree {
  /** Namespace (typically filename without extension) */
  namespace: string;
  /** The mdast tree */
  tree: Root;
  /** Available selectors in this document (for suggestions) */
  availableSelectors: string[];
}

/**
 * Word count options (for consistency with future tree module).
 */
export interface WordCountOptions {
  /** Whether to count code blocks. Default: true */
  countCode?: boolean;
}

/**
 * Resolution context for tracking state during traversal.
 * @internal
 */
export interface ResolutionContext {
  /** Current namespace being resolved */
  namespace: string;
  /** Current path of nodes visited */
  path: any[];
  /** Current node being resolved */
  currentNode: any;
  /** Current depth in the selector path */
  segmentIndex: number;
  /** Total segments in the selector */
  totalSegments: number;
}
