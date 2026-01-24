/**
 * Select command implementation for CLI.
 *
 * Resolves selectors against markdown files and outputs matching content.
 * Default output is minimal text; use --json for JSON format.
 *
 * @module cli/commands/select-command
 */

/* eslint-disable */
import type { SelectMatch, ChildInfo, ErrorEntry } from '../../output/types.js';
import type { ResolutionResult } from '../../resolver/types.js';
import { parseFile, ParserError } from '../../parser/index.js';
import { parseSelector, SelectorParseError } from '../../selector/index.js';
import { resolveMulti, searchMultipleDocuments, type DocumentTree, type SearchResult } from '../../resolver/index.js';
import { formatSelectResponse, formatErrorResponse, createErrorEntry } from '../../output/index.js';
import { formatSelectText, formatErrorText } from '../../output/text-formatters.js';
import { deriveNamespace } from '../utils/namespace.js';
import { buildAvailableSelectors } from '../utils/selector-builder.js';
import { extractMarkdown, truncateContent, type TruncateOptions } from '../utils/content-extractor.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';

/**
 * Options for the select command.
 */
export interface SelectOptions {
  /** Output JSON instead of text */
  json?: boolean;
}

/**
 * Execute the select command.
 *
 * Parses the selector, resolves it against the specified documents,
 * and outputs the matched content.
 * Default output is minimal text; use --json for JSON format.
 *
 * @param selector - The selector string to resolve
 * @param files - Array of file paths to search
 * @param options - Command options
 *
 * @example
 * ```bash
 * mdsel README.md h1.0
 * mdsel README.md CONTRIBUTING.md h2.0
 * mdsel --json docs.md "section[5]?head=10"
 * ```
 */
export async function selectCommand(
  selector: string,
  files: string[],
  options: SelectOptions = {},
): Promise<void> {
  const useJson = options.json === true;

  // Validate files
  if (files.length === 0) {
    const error = createErrorEntry(
      'PARSE_ERROR',
      'NO_FILES',
      'No files provided. Specify files to search.',
    );
    outputError([error], useJson);
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Parse selector - if it fails, maybe treat as search query
  let selectorAst: ReturnType<typeof parseSelector>;
  let parseError: SelectorParseError | null = null;
  try {
    selectorAst = parseSelector(selector);
  } catch (error) {
    if (error instanceof SelectorParseError) {
      parseError = error;
    } else {
      throw error;
    }
  }

  // If selector parsing failed, check if we should search instead
  if (parseError) {
    // Only fall back to search if the input looks like a search query
    // (doesn't contain selector syntax characters that suggest a failed selector)
    const looksLikeSearch = isLikelySearchQuery(selector);

    if (looksLikeSearch) {
      await performSearchFallback(selector, files, options);
      return;
    }

    // Otherwise, report the parse error
    const errorEntry = createErrorEntry(
      'INVALID_SELECTOR',
      parseError.code,
      parseError.message,
      undefined,
      selector,
    );
    outputError([errorEntry], useJson);
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Parse head/tail query params for truncation
  const truncateOptions: TruncateOptions = {};
  if (selectorAst!.queryParams) {
    for (const param of selectorAst.queryParams) {
      if (param.key === 'head') {
        const value = parseInt(param.value, 10);
        if (!isNaN(value) && value > 0) {
          truncateOptions.head = value;
        }
      } else if (param.key === 'tail') {
        const value = parseInt(param.value, 10);
        if (!isNaN(value) && value > 0) {
          truncateOptions.tail = value;
        }
      }
    }
  }

  // Parse all files and build DocumentTree[]
  const documents: DocumentTree[] = [];
  const parseErrors: ErrorEntry[] = [];

  for (const file of files) {
    try {
      const result = await parseFile(file);
      const namespace = deriveNamespace(file);
      const selectors = buildAvailableSelectors(result.ast, namespace);
      documents.push({
        namespace,
        tree: result.ast,
        availableSelectors: selectors,
      });
    } catch (error) {
      if (error instanceof ParserError) {
        parseErrors.push(
          createErrorEntry(
            error.code as 'FILE_NOT_FOUND' | 'PARSE_ERROR',
            error.code,
            error.message,
            error.filePath,
          ),
        );
      } else if (error instanceof Error) {
        parseErrors.push(createErrorEntry('PROCESSING_ERROR', 'UNKNOWN', error.message, file));
      }
    }
  }

  // If no documents could be parsed, return error
  if (documents.length === 0) {
    outputError(parseErrors, useJson);
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Resolve selector
  const outcome = resolveMulti(documents, selectorAst);

  // Format response based on outcome
  if (outcome.success) {
    const matches = formatMatches(outcome.results, truncateOptions);
    if (useJson) {
      const response = formatSelectResponse(matches, []);
      console.log(JSON.stringify(response));
    } else {
      console.log(formatSelectText(matches, []));
    }
    exitWithCode(ExitCode.SUCCESS);
    return;
  }

  // Selector resolution failed
  const err = outcome.error;
  const unresolved = [
    {
      selector: err.selector,
      reason: err.message,
      suggestions: err.suggestions.map((s) => s.selector),
    },
  ];
  if (useJson) {
    const response = formatSelectResponse([], unresolved);
    console.log(JSON.stringify(response));
  } else {
    console.log(formatSelectText([], unresolved));
  }
  exitWithCode(ExitCode.ERROR);
}

/**
 * Output error in appropriate format.
 */
function outputError(errors: ErrorEntry[], useJson: boolean): void {
  if (useJson) {
    // JSON errors to stdout for consistent parsing
    console.log(JSON.stringify(formatErrorResponse('select', errors)));
  } else {
    // Text errors to stderr per Unix convention
    console.error(formatErrorText(errors));
  }
}

// Block types that are selectable (map mdast type to selector shorthand)
const SELECTABLE_BLOCKS: Record<string, string> = {
  paragraph: 'para',
  code: 'code',
  list: 'list',
  table: 'table',
  blockquote: 'quote',
};

/**
 * Format resolution results into SelectMatch objects.
 */
function formatMatches(results: ResolutionResult[], truncateOpts: TruncateOptions): SelectMatch[] {
  return results.map((result) => {
    const { content, truncated } = truncateContent(extractMarkdown(result.node), truncateOpts);

    // Build children_available list - only include selectable block types
    const childrenAvailable: ChildInfo[] = [];
    if (result.childrenAvailable && result.node.children) {
      // Track counts per type for indexing
      const typeCounts: Record<string, number> = {};

      for (const child of result.node.children) {
        const childType = String(child.type);

        // Check if it's a heading
        if (childType === 'heading' && 'depth' in child) {
          const level = `h${child.depth as number}`;
          const idx = typeCounts[level] ?? 0;
          typeCounts[level] = idx + 1;

          const childText = extractMarkdown(child);
          const childPreview = childText.slice(0, 80).replace(/^#+\s*/, '');
          childrenAvailable.push({
            selector: `${level}[${idx}]`,
            type: 'heading',
            preview: childPreview,
          });
        }
        // Check if it's a selectable block
        else if (childType in SELECTABLE_BLOCKS) {
          const shorthand = SELECTABLE_BLOCKS[childType];
          const idx = typeCounts[shorthand] ?? 0;
          typeCounts[shorthand] = idx + 1;

          const childText = extractMarkdown(child);
          const childPreview = childText.slice(0, 80);
          childrenAvailable.push({
            selector: `${shorthand}[${idx}]`,
            type: childType,
            preview: childPreview,
          });
        }
        // Skip inline types (text, emphasis, strong, link, etc.)
      }
    }

    return {
      selector: String(result.selector),
      type: String(result.node.type),
      content,
      truncated,
      children_available: childrenAvailable,
    };
  });
}

/**
 * Execute the select command with multiple selectors.
 *
 * Parses each selector, resolves them against the specified documents,
 * and outputs all matched content.
 *
 * @param selectors - Array of selector strings to resolve
 * @param files - Array of file paths to search
 * @param options - Command options
 *
 * @example
 * ```bash
 * mdsel README.md h1.0 h2.0 h2.1
 * mdsel README.md code.0 para.0
 * ```
 */
export async function selectMultiCommand(
  selectors: string[],
  files: string[],
  options: SelectOptions = {},
): Promise<void> {
  const useJson = options.json === true;

  // Validate files
  if (files.length === 0) {
    const error = createErrorEntry(
      'PARSE_ERROR',
      'NO_FILES',
      'No files provided. Specify files to search.',
    );
    outputError([error], useJson);
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Parse all files and build DocumentTree[]
  const documents: DocumentTree[] = [];
  const parseErrors: ErrorEntry[] = [];

  for (const file of files) {
    try {
      const result = await parseFile(file);
      const namespace = deriveNamespace(file);
      const availableSelectors = buildAvailableSelectors(result.ast, namespace);
      documents.push({
        namespace,
        tree: result.ast,
        availableSelectors,
      });
    } catch (error) {
      if (error instanceof ParserError) {
        parseErrors.push(
          createErrorEntry(
            error.code as 'FILE_NOT_FOUND' | 'PARSE_ERROR',
            error.code,
            error.message,
            error.filePath,
          ),
        );
      } else if (error instanceof Error) {
        parseErrors.push(createErrorEntry('PROCESSING_ERROR', 'UNKNOWN', error.message, file));
      }
    }
  }

  // If no documents could be parsed, return error
  if (documents.length === 0) {
    outputError(parseErrors, useJson);
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Process each selector
  const allMatches: SelectMatch[] = [];
  const allUnresolved: Array<{ selector: string; reason: string; suggestions: string[] }> = [];

  for (const selector of selectors) {
    // Parse selector
    let selectorAst: ReturnType<typeof parseSelector>;
    try {
      selectorAst = parseSelector(selector);
    } catch (error) {
      if (error instanceof SelectorParseError) {
        allUnresolved.push({
          selector,
          reason: error.message,
          suggestions: [],
        });
        continue;
      }
      throw error;
    }

    // Parse head/tail query params for truncation
    const truncateOptions: TruncateOptions = {};
    if (selectorAst.queryParams) {
      for (const param of selectorAst.queryParams) {
        if (param.key === 'head') {
          const value = parseInt(param.value, 10);
          if (!isNaN(value) && value > 0) {
            truncateOptions.head = value;
          }
        } else if (param.key === 'tail') {
          const value = parseInt(param.value, 10);
          if (!isNaN(value) && value > 0) {
            truncateOptions.tail = value;
          }
        }
      }
    }

    // Resolve selector
    const outcome = resolveMulti(documents, selectorAst);

    if (outcome.success) {
      const matches = formatMatches(outcome.results, truncateOptions);
      allMatches.push(...matches);
    } else {
      const err = outcome.error;
      allUnresolved.push({
        selector: err.selector,
        reason: err.message,
        suggestions: err.suggestions.map((s) => s.selector),
      });
    }
  }

  // Output results
  if (useJson) {
    const response = formatSelectResponse(allMatches, allUnresolved);
    console.log(JSON.stringify(response));
  } else {
    console.log(formatSelectText(allMatches, allUnresolved));
  }

  // Exit with error if any selectors failed
  exitWithCode(allUnresolved.length > 0 ? ExitCode.ERROR : ExitCode.SUCCESS);
}

/**
 * Check if the input looks like a search query rather than a failed selector.
 *
 * Returns true if the input doesn't contain typical selector syntax characters.
 */
function isLikelySearchQuery(input: string): boolean {
  // If it's empty, it's not a search query
  if (!input.trim()) {
    return false;
  }

  // Selector syntax characters that suggest the user was trying to write a selector
  // :: (namespace separator)
  // [ ] (index brackets)
  // . followed by number (index like h2.0)
  // : followed by identifier (type specifier like heading:h2)

  // If it has ::, it's a namespace syntax attempt
  if (input.includes('::')) {
    return false;
  }

  // If it has unclosed brackets, it's a syntax error not a search
  if ((input.includes('[') && !input.includes(']')) ||
      (!input.includes('[') && input.includes(']'))) {
    return false;
  }

  // If it looks like a selector pattern (h1, h2, code, para, etc. followed by . or [)
  if (/^(h[1-6]|code|para|paragraph|list|table|quote|blockquote|root|section|heading|block)[\.\[]/.test(input)) {
    return false;
  }

  // If it's a valid selector keyword with a malformed suffix
  if (/^(heading|block):/.test(input)) {
    return false;
  }

  // Otherwise, treat it as a search query
  return true;
}

/**
 * Perform search when selector parsing fails.
 *
 * Treats the input as a search query and finds matching sections.
 */
async function performSearchFallback(
  query: string,
  files: string[],
  options: SelectOptions,
): Promise<void> {
  const useJson = options.json === true;

  // Parse all files
  const documents: Array<{ tree: any; namespace: string }> = [];
  const parseErrors: ErrorEntry[] = [];

  for (const file of files) {
    try {
      const result = await parseFile(file);
      const namespace = deriveNamespace(file);
      documents.push({
        namespace,
        tree: result.ast,
      });
    } catch (error) {
      if (error instanceof ParserError) {
        parseErrors.push(
          createErrorEntry(
            error.code as 'FILE_NOT_FOUND' | 'PARSE_ERROR',
            error.code,
            error.message,
            error.filePath,
          ),
        );
      } else if (error instanceof Error) {
        parseErrors.push(createErrorEntry('PROCESSING_ERROR', 'UNKNOWN', error.message, file));
      }
    }
  }

  // If no documents could be parsed, return error
  if (documents.length === 0) {
    outputError(parseErrors, useJson);
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Perform fuzzy search
  const searchResults = searchMultipleDocuments(documents, query, {
    maxResults: 10,
    minScore: 0.3,
  });

  if (searchResults.length === 0) {
    // No search results found
    const unresolved = [
      {
        selector: query,
        reason: `No matches found for search query "${query}"`,
        suggestions: [],
      },
    ];
    if (useJson) {
      const response = formatSelectResponse([], unresolved);
      console.log(JSON.stringify(response));
    } else {
      console.log(formatSearchText(query, []));
    }
    exitWithCode(ExitCode.ERROR);
    return;
  }

  // Format and output search results
  if (useJson) {
    const matches = formatSearchResultsAsMatches(searchResults);
    const response = {
      success: true,
      command: 'search',
      query,
      timestamp: new Date().toISOString(),
      data: {
        matches,
        unresolved: [],
      },
    };
    console.log(JSON.stringify(response));
  } else {
    console.log(formatSearchText(query, searchResults));
  }

  exitWithCode(ExitCode.SUCCESS);
}

/**
 * Format search results as SelectMatch objects for JSON output.
 */
function formatSearchResultsAsMatches(results: SearchResult[]): SelectMatch[] {
  return results.map((result) => ({
    selector: result.selector,
    type: result.type,
    content: result.content,
    truncated: false,
    children_available: [],
    search_score: result.score,
    match_type: result.matchType,
  }));
}

/**
 * Format search results as text output.
 */
function formatSearchText(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No matches found for: ${query}`;
  }

  const parts: string[] = [];
  parts.push(`Search results for "${query}":`);
  parts.push('');

  for (const result of results) {
    const score = Math.round(result.score * 100);
    parts.push(`${result.selector} (${score}% match)`);
    parts.push(`  ${result.preview}`);
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}
