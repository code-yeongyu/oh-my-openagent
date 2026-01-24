/* eslint-disable */
import { Token, TokenType, Position } from './token';

export interface ParserOptions {
  throwOnError: boolean;
  includeWhitespace: boolean;
  includeNewlines: boolean;
}

export const DEFAULT_PARSER_OPTIONS: ParserOptions = {
  throwOnError: true,
  includeWhitespace: false,
  includeNewlines: false,
};

export function filterTokens(tokens: Token[], options: Partial<ParserOptions> = {}): Token[] {
  const opts = { ...DEFAULT_PARSER_OPTIONS, ...options };

  return tokens.filter((token) => {
    if (token.type === TokenType.ERROR) {
      if (opts.throwOnError) {
        throw new Error(token.value);
      }
      return false;
    }

    if (token.type === TokenType.WHITESPACE && !opts.includeWhitespace) {
      return false;
    }

    if (token.type === TokenType.NEWLINE && !opts.includeNewlines) {
      return false;
    }

    return true;
  });
}

export function findTokenAtPosition(tokens: Token[], position: Position): Token | null {
  return (
    tokens.find(
      (token) => position.offset >= token.start.offset && position.offset < token.end.offset,
    ) || null
  );
}

export function formatTokensForDebug(tokens: Token[]): string {
  return tokens
    .map((token) => {
      const pos = `${token.start.line}:${token.start.column}`;
      const value = token.value.length > 20 ? `${token.value.substring(0, 20)}...` : token.value;
      return `${pos.padEnd(10)} ${token.type.padEnd(20)} "${value}"`;
    })
    .join('\n');
}

export function getTokenRange(tokens: Token[], startType: TokenType, endType: TokenType): Token[] {
  const startIndex = tokens.findIndex((t) => t.type === startType);
  const endIndex = tokens.findIndex((t) => t.type === endType);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return [];
  }

  return tokens.slice(startIndex, endIndex + 1);
}
