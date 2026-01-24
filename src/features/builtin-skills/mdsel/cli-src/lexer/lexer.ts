/* eslint-disable */
import { Token, TokenType } from './token';

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export class LexerError extends Error {
  constructor(
    message: string,
    public position: Position,
    public code?: string,
  ) {
    super(message);
    this.name = 'LexerError';
  }

  toString(): string {
    return `Line ${this.position.line}, Column ${this.position.column}: ${this.message}`;
  }
}

export class Lexer {
  private input: string;
  private position = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  private get currentChar(): string {
    return this.input[this.position] || '';
  }

  private get nextChar(): string {
    return this.input[this.position + 1] || '';
  }

  private peek(offset = 1): string {
    return this.input[this.position + offset] || '';
  }

  private advance(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (this.input[this.position] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.position++;
    }
  }

  private createToken(type: TokenType, value: string, start: Position, end: Position): Token {
    return { type, value, start, end };
  }

  private createErrorToken(message: string, position: Position): Token {
    return {
      type: TokenType.ERROR,
      value: message,
      start: position,
      end: { ...position, offset: position.offset + 1 },
    };
  }

  private getPosition(): Position {
    return { line: this.line, column: this.column, offset: this.position };
  }

  private isAtEnd(): boolean {
    return this.position >= this.input.length;
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.currentChar)) {
      if (this.currentChar === '\n') {
        this.advance();
        this.tokens.push(
          this.createToken(TokenType.NEWLINE, '\n', this.getPosition(), this.getPosition()),
        );
      } else {
        this.advance();
        this.tokens.push(
          this.createToken(TokenType.WHITESPACE, ' ', this.getPosition(), this.getPosition()),
        );
      }
    }
  }

  private readIdentifier(): string {
    const start = this.position;
    while (!this.isAtEnd() && /[a-zA-Z_0-9]/.test(this.currentChar)) {
      this.advance();
    }
    return this.input.slice(start, this.position);
  }

  private readNumber(): string {
    const start = this.position;
    while (!this.isAtEnd() && /[0-9]/.test(this.currentChar)) {
      this.advance();
    }
    return this.input.slice(start, this.position);
  }

  private tokenizeIdentifier(start: Position): Token | null {
    const value = this.readIdentifier();

    // Check for keywords
    let type = TokenType.IDENTIFIER;
    switch (value) {
      case 'heading':
        type = TokenType.HEADING_KEYWORD;
        break;
      case 'block':
        type = TokenType.BLOCK_KEYWORD;
        break;
      case 'namespace':
        type = TokenType.NAMESPACE_KEYWORD;
        break;
      default:
        type = TokenType.IDENTIFIER;
    }

    return this.createToken(type, value, start, this.getPosition());
  }

  private tokenizeNumber(start: Position): Token | null {
    const value = this.readNumber();
    this.tokens.push(this.createToken(TokenType.NUMBER, value, start, this.getPosition()));
    return null; // Token already added
  }

  private tokenizeString(start: Position): Token | null {
    const quoteChar = this.currentChar;
    this.advance(); // Skip opening quote

    const value: string[] = [];
    let escaped = false;

    while (!this.isAtEnd()) {
      const char = this.currentChar;

      if (escaped) {
        if (char === 'n') {
          value.push('\n');
        } else if (char === 't') {
          value.push('\t');
        } else if (char === 'r') {
          value.push('\r');
        } else if (char === '\\') {
          value.push('\\');
        } else if (char === quoteChar) {
          value.push(quoteChar);
        } else {
          value.push('\\' + char);
        }
        escaped = false;
        this.advance();
      } else if (char === '\\') {
        escaped = true;
        this.advance();
      } else if (char === quoteChar) {
        this.advance(); // Skip closing quote
        return this.createToken(TokenType.STRING, value.join(''), start, this.getPosition());
      } else {
        value.push(char);
        this.advance();
      }
    }

    return this.createErrorToken('Unterminated string', start);
  }

  private tokenizeMultiCharOperator(start: Position): Token | null {
    const current = this.currentChar;
    const next = this.nextChar;
    const twoChar = current + next;

    switch (twoChar) {
      case '::':
        this.advance(2);
        return this.createToken(TokenType.NAMESPACE_SEPARATOR, '::', start, this.getPosition());
      default:
        // Single character
        this.advance();
        return this.createToken(
          current === '/' ? TokenType.PATH_SEPARATOR : TokenType.PUNCTUATION,
          current,
          start,
          this.getPosition(),
        );
    }
  }

  public tokenize(): Token[] {
    this.tokens = [];
    this.position = 0;
    this.line = 1;
    this.column = 1;

    while (!this.isAtEnd()) {
      const start = this.getPosition();

      // Skip whitespace
      if (/\s/.test(this.currentChar)) {
        this.skipWhitespace();
        continue;
      }

      // Handle different token types
      let token: Token | null = null;

      // Multi-character operators (check first)
      if (this.currentChar === '/' || this.currentChar === ':') {
        token = this.tokenizeMultiCharOperator(start);
        if (token) {
          this.tokens.push(token);
          continue;
        }
      }

      // Brackets
      if (this.currentChar === '[') {
        this.advance();
        this.tokens.push(this.createToken(TokenType.OPEN_BRACKET, '[', start, this.getPosition()));
        continue;
      }

      if (this.currentChar === ']') {
        this.advance();
        this.tokens.push(this.createToken(TokenType.CLOSE_BRACKET, ']', start, this.getPosition()));
        continue;
      }

      // Query separators
      if (this.currentChar === '?' || this.currentChar === '&') {
        const type = this.currentChar === '?' ? TokenType.QUERY_SEPARATOR : TokenType.AND_SEPARATOR;
        this.advance();
        this.tokens.push(this.createToken(type, this.currentChar, start, this.getPosition()));
        continue;
      }

      // Strings
      if (this.currentChar === '"' || this.currentChar === "'") {
        token = this.tokenizeString(start);
        this.tokens.push(token);
        continue;
      }

      // Numbers
      if (/[0-9]/.test(this.currentChar)) {
        token = this.tokenizeNumber(start);
        this.tokens.push(token);
        continue;
      }

      // Identifiers
      if (/[a-zA-Z_]/.test(this.currentChar)) {
        token = this.tokenizeIdentifier(start);
        this.tokens.push(token);
        continue;
      }

      // Unknown character - error token
      const unknownChar = this.currentChar;
      this.advance();
      this.tokens.push(this.createToken(TokenType.ERROR, unknownChar, start, this.getPosition()));
    }

    // Add EOF token
    this.tokens.push(this.createToken(TokenType.EOF, '', this.getPosition(), this.getPosition()));

    return this.tokens;
  }

  // Helper method to tokenize with error handling
  public tokenizeWithErrorHandling(): Token[] {
    try {
      return this.tokenize();
    } catch (error) {
      if (error instanceof LexerError) {
        throw error;
      }
      throw new LexerError(`Unexpected error during tokenization: ${error}`, this.getPosition());
    }
  }
}
