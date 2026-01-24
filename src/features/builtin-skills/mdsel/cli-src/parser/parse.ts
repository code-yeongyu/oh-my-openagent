import { readFile, access, stat } from 'node:fs/promises';
import { createProcessor } from './processor.js';
import { ParserError, type ParserOptions, type ParseResult } from './types.js';
import {
  isLikelyBinary,
  isValidUtf8,
  sanitizeInput,
  getNestingDepth,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_DEPTH,
  formatFileSize,
} from '../utils/validation.js';

/**
 * Parses a Markdown string into an mdast Abstract Syntax Tree.
 *
 * @param content - The Markdown content to parse
 * @param options - Parser configuration options
 * @returns The parsed AST wrapped in a ParseResult
 *
 * @example
 * ```typescript
 * const result = parseMarkdown('# Hello\n\nWorld');
 * console.log(result.ast.children[0].type); // 'heading'
 * ```
 */
export function parseMarkdown(content: string, options?: ParserOptions): ParseResult {
  const processor = createProcessor(options);
  const ast = processor.parse(content);

  // Validate depth after parsing
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const actualDepth = getNestingDepth(ast);
  if (actualDepth > maxDepth) {
    throw new Error(
      `Maximum nesting depth of ${String(maxDepth)} exceeded (found depth of ${String(actualDepth)}). ` +
        'Consider increasing the maxDepth option if this is expected.',
    );
  }

  return { ast };
}

/**
 * Reads a Markdown file and parses it into an mdast Abstract Syntax Tree.
 *
 * @param filePath - Path to the Markdown file
 * @param options - Parser configuration options
 * @returns The parsed AST wrapped in a ParseResult, including the file path
 * @throws {ParserError} When the file cannot be read or parsed
 *
 * @example
 * ```typescript
 * const result = await parseFile('./README.md');
 * console.log(result.filePath); // './README.md'
 * console.log(result.ast.type); // 'root'
 * ```
 */
export async function parseFile(filePath: string, options?: ParserOptions): Promise<ParseResult> {
  const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  // Check file exists first for better error messages
  try {
    await access(filePath);
  } catch {
    throw new ParserError('FILE_NOT_FOUND', `File not found: ${filePath}`, filePath);
  }

  // Check file size before reading
  let fileSize: number;
  try {
    const stats = await stat(filePath);
    fileSize = stats.size;
    if (fileSize > maxFileSize) {
      throw new ParserError(
        'FILE_TOO_LARGE',
        `File size (${formatFileSize(fileSize)}) exceeds maximum allowed size (${formatFileSize(maxFileSize)})`,
        filePath,
      );
    }
  } catch (error) {
    if (error instanceof ParserError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown stat error';
    throw new ParserError('FILE_READ_ERROR', `Failed to read file stats: ${message}`, filePath);
  }

  // Read file content as buffer first for validation
  let buffer: Buffer;
  let content: string;
  try {
    buffer = await readFile(filePath);

    // Validate UTF-8 encoding before converting to string
    if (!isValidUtf8(buffer)) {
      throw new ParserError(
        'ENCODING_ERROR',
        'File contains invalid UTF-8 byte sequences',
        filePath,
      );
    }

    // Convert to string
    content = buffer.toString('utf-8');
  } catch (error) {
    if (error instanceof ParserError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown read error';
    throw new ParserError('FILE_READ_ERROR', `Failed to read file: ${message}`, filePath);
  }

  // Check for binary content
  if (isLikelyBinary(content)) {
    throw new ParserError(
      'BINARY_FILE',
      'File appears to be binary content rather than text markdown',
      filePath,
    );
  }

  // Normalize line endings
  content = sanitizeInput(content);

  // Parse the content
  const result = parseMarkdown(content, options);

  return {
    ...result,
    filePath,
  };
}
