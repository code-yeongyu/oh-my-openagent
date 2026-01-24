import type {
  CLIResponse,
  IndexResponse,
  SelectResponse,
  ErrorEntry,
  DocumentIndex,
  IndexSummary,
  SelectMatch,
  UnresolvedSelector,
  ErrorType,
} from './types.js';
import { createTimestamp, omitNullFields } from './utils.js';

/**
 * Format an index command response.
 *
 * @param documents - Document indices
 * @param summary - Summary statistics
 * @returns Formatted index response
 */
export function formatIndexResponse(
  documents: DocumentIndex[],
  summary: IndexSummary,
): CLIResponse<IndexResponse> {
  return {
    success: true,
    command: 'index',
    timestamp: createTimestamp(),
    data: {
      documents,
      summary,
    },
  };
}

/**
 * Format a select command response.
 *
 * @param matches - Selector matches
 * @param unresolved - Unresolved selectors (optional)
 * @returns Formatted select response
 */
export function formatSelectResponse(
  matches: SelectMatch[],
  unresolved: UnresolvedSelector[] = [],
): CLIResponse<SelectResponse> {
  const hasErrors = unresolved.length > 0;

  const response: CLIResponse<SelectResponse> = {
    success: !hasErrors,
    command: 'select',
    timestamp: createTimestamp(),
    data: {
      matches,
      unresolved,
    },
  };

  if (unresolved.length > 0) {
    response.unresolved_selectors = unresolved.map((u) => u.selector);
  }

  return response;
}

/**
 * Format an error response.
 *
 * @param command - The command that failed
 * @param errors - Error entries
 * @param partialResults - Optional partial results
 * @returns Formatted error response
 */
export function formatErrorResponse(
  command: 'index' | 'select',
  errors: ErrorEntry[],
  partialResults?: unknown[],
): CLIResponse<null> {
  const response: CLIResponse<null> = {
    success: false,
    command,
    timestamp: createTimestamp(),
    data: null,
    errors,
  };

  if (partialResults && partialResults.length > 0) {
    response.partial_results = partialResults as null[];
  }

  return response;
}

/**
 * Create an error entry.
 *
 * @param type - Error type
 * @param code - Error code
 * @param message - Error message
 * @param file - Optional file path
 * @param selector - Optional selector
 * @param suggestions - Optional suggestions
 * @returns ErrorEntry object
 */
export function createErrorEntry(
  type: ErrorType,
  code: string,
  message: string,
  file?: string,
  selector?: string,
  suggestions?: string[],
): ErrorEntry {
  return omitNullFields({
    type,
    code,
    message,
    file,
    selector,
    suggestions,
  }) as ErrorEntry;
}
