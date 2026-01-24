// Public API for the output module

// Formatters
export {
  formatIndexResponse,
  formatSelectResponse,
  formatErrorResponse,
  createErrorEntry,
} from './formatters.js';

// Utilities
export {
  createTimestamp,
  createResponseEnvelope,
  omitNullFields,
  sanitizeForJson,
} from './utils.js';

// Types
export type {
  CLIResponse,
  IndexResponse,
  SelectResponse,
  ErrorEntry,
  ErrorType,
  DocumentIndex,
  NodeDescriptor,
  HeadingDescriptor,
  BlockSummary,
  IndexSummary,
  SelectMatch,
  PaginationInfo,
  ChildInfo,
  UnresolvedSelector,
} from './types.js';
