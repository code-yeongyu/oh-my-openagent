export enum TokenType {
  // Keywords
  HEADING_KEYWORD = 'HEADING_KEYWORD',
  BLOCK_KEYWORD = 'BLOCK_KEYWORD',
  NAMESPACE_KEYWORD = 'NAMESPACE_KEYWORD',

  // Identifiers
  IDENTIFIER = 'IDENTIFIER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',

  // Operators
  NAMESPACE_SEPARATOR = 'NAMESPACE_SEPARATOR',
  PATH_SEPARATOR = 'PATH_SEPARATOR',
  PUNCTUATION = 'PUNCTUATION',

  // Brackets
  OPEN_BRACKET = 'OPEN_BRACKET',
  CLOSE_BRACKET = 'CLOSE_BRACKET',

  // Query
  QUERY_SEPARATOR = 'QUERY_SEPARATOR',
  AND_SEPARATOR = 'AND_SEPARATOR',

  // Whitespace
  WHITESPACE = 'WHITESPACE',
  NEWLINE = 'NEWLINE',

  // Special
  EOF = 'EOF',
  ERROR = 'ERROR',
}

export interface Token {
  type: TokenType;
  value: string;
  start: Position;
  end: Position;
}

export interface Position {
  line: number;
  column: number;
  offset: number;
}
