import { TokenType, type Token, type Position, SelectorParseError } from './types.js';

/**
 * Tokenizes a selector string into an array of tokens.
 *
 * @param input - The selector string to tokenize
 * @returns Array of tokens ending with EOF
 * @throws {SelectorParseError} When encountering invalid characters
 *
 * @example
 * ```typescript
 * const tokens = tokenize('heading:h2[1]');
 * // Returns:
 * // [
 * //   { type: TokenType.HEADING, value: 'heading', position: {...} },
 * //   { type: TokenType.COLON, value: ':', position: {...} },
 * //   { type: TokenType.IDENTIFIER, value: 'h2', position: {...} },
 * //   { type: TokenType.OPEN_BRACKET, value: '[', position: {...} },
 * //   { type: TokenType.NUMBER, value: '1', position: {...} },
 * //   { type: TokenType.CLOSE_BRACKET, value: ']', position: {...} },
 * //   { type: TokenType.EOF, value: '', position: {...} }
 * // ]
 * ```
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const position = (): Position => ({ line, column, offset: index });

  const isAtEnd = () => index >= input.length;

  const advance = () => {
    if (!isAtEnd()) {
      if (input[index] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      index++;
    }
  };

  const peek = (offset = 0): string => {
    const pos = index + offset;
    return pos < input.length ? (input[pos] ?? '') : '';
  };

  const skipWhitespace = () => {
    while (!isAtEnd() && /\s/.test(peek())) {
      advance();
    }
  };

  const scanIdentifier = (): string => {
    const start = index;
    while (!isAtEnd() && /[a-zA-Z0-9_-]/.test(peek())) {
      advance();
    }
    return input.slice(start, index);
  };

  const scanNumber = (): string => {
    const start = index;
    while (!isAtEnd() && /[0-9]/.test(peek())) {
      advance();
    }
    return input.slice(start, index);
  };

  const scanString = (): string => {
    const quote = peek();
    advance(); // Opening quote
    const start = index;
    while (!isAtEnd() && peek() !== quote) {
      advance();
    }
    const value = input.slice(start, index);
    advance(); // Closing quote
    return value;
  };

  const addToken = (type: TokenType, value: string, pos?: Position) => {
    tokens.push({ type, value, position: pos ?? position() });
  };

  // Handle empty input
  if (input.trim() === '') {
    addToken(TokenType.EOF, '');
    return tokens;
  }

  // Main scanning loop
  while (!isAtEnd()) {
    skipWhitespace();

    if (isAtEnd()) break;

    const char = peek();
    const pos = position();

    // Check for multi-character tokens FIRST (critical gotcha)
    if (char === ':' && peek(1) === ':') {
      advance();
      advance();
      addToken(TokenType.NAMESPACE_SEP, '::', pos);
      continue;
    }

    // Single character tokens
    switch (char) {
      case '/':
        advance();
        addToken(TokenType.SLASH, '/', pos);
        continue;
      case ':':
        advance();
        addToken(TokenType.COLON, ':', pos);
        continue;
      case '.':
        advance();
        addToken(TokenType.DOT, '.', pos);
        continue;
      case '-':
        advance();
        addToken(TokenType.HYPHEN, '-', pos);
        continue;
      case ',':
        advance();
        addToken(TokenType.COMMA, ',', pos);
        continue;
      case '[':
        advance();
        addToken(TokenType.OPEN_BRACKET, '[', pos);
        continue;
      case ']':
        advance();
        addToken(TokenType.CLOSE_BRACKET, ']', pos);
        continue;
      case '?':
        advance();
        addToken(TokenType.QUESTION, '?', pos);
        continue;
      case '&':
        advance();
        addToken(TokenType.AMPERSAND, '&', pos);
        continue;
      case '=':
        advance();
        addToken(TokenType.EQUALS, '=', pos);
        continue;
      case '*':
        advance();
        addToken(TokenType.STAR, '*', pos);
        continue;
      case '"':
      case "'": {
        const strPos = position();
        const str = scanString();
        addToken(TokenType.STRING, str, strPos);
        continue;
      }
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      const numPos = position();
      const num = scanNumber();
      addToken(TokenType.NUMBER, num, numPos);
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      const identPos = position();
      const identifier = scanIdentifier();

      // Check for keywords
      switch (identifier) {
        case 'root':
          addToken(TokenType.ROOT, identifier, identPos);
          break;
        case 'heading':
          addToken(TokenType.HEADING, identifier, identPos);
          break;
        case 'section':
          addToken(TokenType.SECTION, identifier, identPos);
          break;
        case 'block':
          addToken(TokenType.BLOCK, identifier, identPos);
          break;
        case 'page':
          addToken(TokenType.PAGE, identifier, identPos);
          break;
        default:
          addToken(TokenType.IDENTIFIER, identifier, identPos);
      }
      continue;
    }

    // Invalid character
    throw new SelectorParseError(
      'INVALID_SYNTAX',
      `Invalid character '${char}' in selector`,
      pos,
      input,
    );
  }

  // Add EOF token
  addToken(TokenType.EOF, '');

  return tokens;
}
