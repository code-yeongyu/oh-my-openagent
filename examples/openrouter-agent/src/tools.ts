import { tool } from "@openrouter/agent"
import { z } from "zod"

const TokenKind = {
  Number: "number",
  Plus: "plus",
  Minus: "minus",
  Star: "star",
  Slash: "slash",
  LeftParen: "left_paren",
  RightParen: "right_paren",
} as const

type TokenKind = (typeof TokenKind)[keyof typeof TokenKind]

type Token =
  | { readonly kind: typeof TokenKind.Number; readonly value: number }
  | { readonly kind: typeof TokenKind.Plus }
  | { readonly kind: typeof TokenKind.Minus }
  | { readonly kind: typeof TokenKind.Star }
  | { readonly kind: typeof TokenKind.Slash }
  | { readonly kind: typeof TokenKind.LeftParen }
  | { readonly kind: typeof TokenKind.RightParen }

export class CalculationError extends Error {
  readonly name = "CalculationError"
}

export function calculateExpression(expression: string): number {
  const parser = new ExpressionParser(tokenize(expression))
  const result = parser.parse()
  if (!Number.isFinite(result)) {
    throw new CalculationError("calculation produced a non-finite result")
  }
  return result
}

class ExpressionParser {
  private index = 0

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.parseExpression()
    if (this.peek() !== undefined) {
      throw new CalculationError("unexpected token after expression")
    }
    return value
  }

  private parseExpression(): number {
    let value = this.parseTerm()
    while (true) {
      const token = this.peek()
      if (token?.kind === TokenKind.Plus) {
        this.index += 1
        value += this.parseTerm()
        continue
      }
      if (token?.kind === TokenKind.Minus) {
        this.index += 1
        value -= this.parseTerm()
        continue
      }
      return value
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor()
    while (true) {
      const token = this.peek()
      if (token?.kind === TokenKind.Star) {
        this.index += 1
        value *= this.parseFactor()
        continue
      }
      if (token?.kind === TokenKind.Slash) {
        this.index += 1
        value /= this.parseFactor()
        continue
      }
      return value
    }
  }

  private parseFactor(): number {
    const token = this.consume()
    switch (token.kind) {
      case TokenKind.Number:
        return token.value
      case TokenKind.Minus:
        return -this.parseFactor()
      case TokenKind.LeftParen: {
        const value = this.parseExpression()
        this.expect(TokenKind.RightParen)
        return value
      }
      case TokenKind.Plus:
      case TokenKind.Star:
      case TokenKind.Slash:
      case TokenKind.RightParen:
        throw new CalculationError("expected a number or parenthesized expression")
      default:
        return assertNever(token)
    }
  }

  private expect(kind: TokenKind): void {
    const token = this.consume()
    if (token.kind !== kind) {
      throw new CalculationError("unexpected token")
    }
  }

  private consume(): Token {
    const token = this.peek()
    if (token === undefined) {
      throw new CalculationError("unexpected end of expression")
    }
    this.index += 1
    return token
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }
}

function tokenize(expression: string): readonly Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < expression.length) {
    const char = expression[index]
    if (char === undefined) {
      break
    }
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      const numberToken = readNumber(expression, index)
      tokens.push(numberToken.token)
      index = numberToken.nextIndex
      continue
    }
    const token = operatorToken(char)
    if (token === null) {
      throw new CalculationError(`unsupported character: ${char}`)
    }
    tokens.push(token)
    index += 1
  }
  return tokens
}

function readNumber(
  expression: string,
  startIndex: number,
): { readonly token: Token; readonly nextIndex: number } {
  let index = startIndex
  while (index < expression.length) {
    const char = expression[index]
    if (char === undefined || !/[0-9.]/.test(char)) {
      break
    }
    index += 1
  }
  const raw = expression.slice(startIndex, index)
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new CalculationError(`invalid number: ${raw}`)
  }
  return { token: { kind: TokenKind.Number, value }, nextIndex: index }
}

function operatorToken(char: string): Token | null {
  switch (char) {
    case "+":
      return { kind: TokenKind.Plus }
    case "-":
      return { kind: TokenKind.Minus }
    case "*":
      return { kind: TokenKind.Star }
    case "/":
      return { kind: TokenKind.Slash }
    case "(":
      return { kind: TokenKind.LeftParen }
    case ")":
      return { kind: TokenKind.RightParen }
    default:
      return null
  }
}

const TimeInputSchema = z.object({
  timezone: z.string().optional().describe('Timezone such as "UTC" or "America/New_York"'),
})

const TimeOutputSchema = z.object({
  time: z.string(),
  timezone: z.string(),
})

const CalculatorInputSchema = z.object({
  expression: z.string().min(1).describe('Math expression such as "2 * (3 + 4)"'),
})

const CalculatorOutputSchema = z.object({
  expression: z.string(),
  result: z.number(),
})

export const timeTool = tool({
  name: "get_current_time",
  description: "Get the current date and time.",
  inputSchema: TimeInputSchema,
  outputSchema: TimeOutputSchema,
  execute: ({ timezone }) => {
    const resolvedTimezone = timezone ?? "UTC"
    return {
      time: new Date().toLocaleString("en-US", { timeZone: resolvedTimezone }),
      timezone: resolvedTimezone,
    }
  },
})

export const calculatorTool = tool({
  name: "calculate",
  description: "Perform arithmetic with +, -, *, /, decimals, and parentheses.",
  inputSchema: CalculatorInputSchema,
  outputSchema: CalculatorOutputSchema,
  execute: ({ expression }) => ({
    expression,
    result: calculateExpression(expression),
  }),
})

export const defaultTools = [timeTool, calculatorTool] as const

function assertNever(value: never): never {
  throw new CalculationError(`unhandled token: ${String(value)}`)
}
