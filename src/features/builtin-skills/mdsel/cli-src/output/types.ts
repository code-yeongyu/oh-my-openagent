// Type imports removed - not used in this file

/**
 * Response envelope for all CLI commands.
 *
 * Ensures consistent JSON output structure for LLM agent consumption.
 * All responses include success boolean, command type, and timestamp.
 */
export interface CLIResponse<T = unknown> {
  /** Whether the command succeeded */
  success: boolean;
  /** The command that was executed */
  command: 'index' | 'select';
  /** ISO 8601 timestamp of response */
  timestamp: string;
  /** Response data (null on complete error) */
  data: T | null;
  /** Partial results if some operations succeeded */
  partial_results?: T[];
  /** Selectors that could not be resolved */
  unresolved_selectors?: string[];
  /** Warning messages */
  warnings?: string[];
  /** Error entries */
  errors?: ErrorEntry[];
}

/**
 * Error entry for error responses.
 */
export interface ErrorEntry {
  /** File where error occurred */
  file?: string;
  /** Selector that caused error */
  selector?: string;
  /** Error type code */
  type: ErrorType;
  /** Error message */
  message: string;
  /** Machine-readable error code */
  code: string;
  /** Suggested corrections */
  suggestions?: string[];
}

/**
 * Error type codes.
 */
export type ErrorType =
  | 'FILE_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'INVALID_SELECTOR'
  | 'SELECTOR_NOT_FOUND'
  | 'NAMESPACE_NOT_FOUND'
  | 'PROCESSING_ERROR';

/**
 * Index command response data.
 */
export interface IndexResponse {
  /** Document indices */
  documents: DocumentIndex[];
  /** Summary statistics */
  summary: IndexSummary;
}

/**
 * Document index.
 */
export interface DocumentIndex {
  /** Document namespace */
  namespace: string;
  /** File path */
  file_path: string;
  /** Root node info */
  root: NodeDescriptor | null;
  /** Heading descriptors */
  headings: HeadingDescriptor[];
  /** Block summary */
  blocks: BlockSummary;
}

/**
 * Node descriptor for index output.
 */
export interface NodeDescriptor {
  /** Node selector */
  selector: string;
  /** Node type */
  type: string;
  /** Content preview */
  content_preview: string;
  /** Whether truncated */
  truncated: boolean;
  /** Number of children */
  children_count: number;
  /** Word count */
  word_count: number;
}

/**
 * Heading descriptor (extends NodeDescriptor).
 */
export interface HeadingDescriptor extends NodeDescriptor {
  /** Heading depth */
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** Full heading text */
  text: string;
  /** Section word count */
  section_word_count: number;
  /** Whether section is truncated */
  section_truncated: boolean;
}

/**
 * Block counts summary.
 */
export interface BlockSummary {
  paragraphs: number;
  code_blocks: number;
  lists: number;
  tables: number;
  blockquotes: number;
}

/**
 * Index summary statistics.
 */
export interface IndexSummary {
  total_documents: number;
  total_nodes: number;
  total_selectors: number;
}

/**
 * Select command response data.
 */
export interface SelectResponse {
  /** Selector matches */
  matches: SelectMatch[];
  /** Unresolved selectors */
  unresolved: UnresolvedSelector[];
}

/**
 * Select match result.
 */
export interface SelectMatch {
  /** Selector that matched */
  selector: string;
  /** Node type */
  type: string;
  /** Extracted content */
  content: string;
  /** Whether content was truncated */
  truncated: boolean;
  /** Pagination info (if paginated) */
  pagination?: PaginationInfo;
  /** Available child selectors */
  children_available: ChildInfo[];
}

/**
 * Pagination information for large content.
 */
export interface PaginationInfo {
  /** Current page number (1-indexed) */
  current_page: number;
  /** Total number of pages */
  total_pages: number;
  /** Word count of current page */
  word_count: number;
  /** Whether more pages are available */
  has_more: boolean;
}

/**
 * Child node information.
 */
export interface ChildInfo {
  /** Child selector */
  selector: string;
  /** Child node type */
  type: string;
  /** Content preview */
  preview: string;
}

/**
 * Unresolved selector info.
 */
export interface UnresolvedSelector {
  selector: string;
  reason: string;
  suggestions: string[];
}
