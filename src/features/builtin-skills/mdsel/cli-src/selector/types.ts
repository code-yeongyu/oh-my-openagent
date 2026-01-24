/**
 * Token types produced by the tokenizer.
 */
export enum TokenType {
  // Identifiers and keywords
  IDENTIFIER = 'IDENTIFIER',
  ROOT = 'ROOT',
  HEADING = 'HEADING',
  SECTION = 'SECTION',
  BLOCK = 'BLOCK',
  PAGE = 'PAGE',

  // Separators and operators
  NAMESPACE_SEP = 'NAMESPACE_SEP', // ::
  COLON = 'COLON', // :
  DOT = 'DOT', // .
  HYPHEN = 'HYPHEN', // -
  COMMA = 'COMMA', // ,
  SLASH = 'SLASH', // /
  QUESTION = 'QUESTION', // ?
  AMPERSAND = 'AMPERSAND', // &
  EQUALS = 'EQUALS', // =

  // Brackets
  OPEN_BRACKET = 'OPEN_BRACKET', // [
  CLOSE_BRACKET = 'CLOSE_BRACKET', // ]

  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',

  // Special
  STAR = 'STAR', // *
  EOF = 'EOF',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Position information for error reporting.
 */
export interface Position {
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
  /** 0-based byte offset */
  offset: number;
}

/**
 * A single token produced by the tokenizer.
 */
export interface Token {
  type: TokenType;
  value: string;
  position: Position;
}

/**
 * Node types in the selector AST.
 */
export enum SelectorNodeType {
  SELECTOR = 'selector',
  PATH_SEGMENT = 'path_segment',
  ROOT = 'root',
  HEADING = 'heading',
  SECTION = 'section',
  BLOCK = 'block',
  PAGE = 'page',
}

/**
 * Base interface for all AST nodes.
 */
export interface BaseSelectorNode {
  type: SelectorNodeType;
  position: Position;
}

/**
 * Root selector AST node.
 */
export interface SelectorAST extends BaseSelectorNode {
  type: SelectorNodeType.SELECTOR;
  namespace?: string;
  segments: PathSegmentNode[];
  queryParams?: QueryParam[];
}

/**
 * Path segment node (heading:h2[1], block:code[0], etc).
 * Supports single index, range (via array), or multiple indices.
 */
export interface PathSegmentNode extends BaseSelectorNode {
  type: SelectorNodeType.PATH_SEGMENT;
  nodeType: 'root' | 'heading' | 'section' | 'block' | 'page' | 'all';
  subtype?: HeadingLevel | BlockType;
  index?: number | number[];
  position: Position;
}

/**
 * Heading level (h1-h6).
 */
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * Block type.
 */
export type BlockType = 'paragraph' | 'list' | 'code' | 'table' | 'blockquote';

/**
 * Query parameter node.
 */
export interface QueryParam {
  key: string;
  value: string;
  position: Position;
}

/**
 * Error codes for selector parsing failures.
 */
export type SelectorErrorCode =
  | 'INVALID_SYNTAX'
  | 'INVALID_HEADING_LEVEL'
  | 'INVALID_BLOCK_TYPE'
  | 'INVALID_INDEX'
  | 'INVALID_NAMESPACE'
  | 'UNCLOSED_BRACKET'
  | 'EMPTY_SELECTOR'
  | 'TRAILING_SLASH'
  | 'MALFORMED_QUERY';

/**
 * Custom error class for selector parsing failures.
 */
export class SelectorParseError extends Error {
  public readonly code: SelectorErrorCode;
  public readonly position: Position;
  public readonly input: string;

  constructor(code: SelectorErrorCode, message: string, position: Position, input: string) {
    super(message);
    this.name = 'SelectorParseError';
    this.code = code;
    this.position = position;
    this.input = input;
    // Maintains proper stack trace in V8 environments
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    Error.captureStackTrace?.(this, SelectorParseError);
  }

  /**
   * Format error message with position context.
   */
  toString(): string {
    const { line, column, offset } = this.position;
    const lineStart = this.input.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = this.input.indexOf('\n', offset);
    const lineContent = this.input.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const pointer = ' '.repeat(column - 1) + '^';

    return (
      `${this.message}\n` +
      `  at line ${String(line)}, column ${String(column)}\n` +
      `  ${lineContent}\n` +
      `  ${pointer}`
    );
  }
}
