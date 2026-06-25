import type { GrammarRule, ValidationResult, Violation } from "./types";

type Span = { offset: number; length: number };

const JSON_LEAK_RULE_ID = "json-leak-heuristic";

const FORBIDDEN_RULES: GrammarRule[] = [
  f("code-fence-triple-backtick", /(^```|^~~~|```)/mu, "Triple backtick or tilde code fences are forbidden in voice output."),
  f("code-span-single-backtick", /`[^`\n]+`/u, "Single backtick code spans are forbidden in voice output."),
  f("markdown-heading-h1", /^#\s+\S/mu, "Markdown H1 headings are forbidden in voice output."),
  f("markdown-heading-h2", /^##\s+\S/mu, "Markdown H2 headings are forbidden in voice output."),
  f("markdown-heading-h3", /^###\s+\S/mu, "Markdown H3 headings are forbidden in voice output."),
  f("markdown-heading-h4", /^####\s+\S/mu, "Markdown H4 headings are forbidden in voice output."),
  f("markdown-heading-h5", /^#####\s+\S/mu, "Markdown H5 headings are forbidden in voice output."),
  f("markdown-heading-h6", /^######\s+\S/mu, "Markdown H6 headings are forbidden in voice output."),
  f("markdown-list-dash", /^-\s+/mu, "Dash bullet lists are forbidden in voice output."),
  f("markdown-list-asterisk", /^\*\s+/mu, "Asterisk bullet lists are forbidden in voice output."),
  f("markdown-list-plus", /^\+\s+/mu, "Plus bullet lists are forbidden in voice output."),
  f("markdown-list-numbered", /^\d+\.\s+/mu, "Numbered Markdown lists are forbidden in voice output."),
  f("markdown-table", /^\|.*\|$\n^\|[-:|\s]+\|$/mu, "Markdown table rows followed by separator rows are forbidden in voice output."),
  f("markdown-link", /\[[^\]]+\]\([^)]+\)/u, "Markdown links are forbidden in voice output."),
  f("markdown-image", /!\[[^\]]*\]\([^)]+\)/u, "Markdown images are forbidden in voice output."),
  f("emoji-unicode", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F900}-\u{1F9FF}]/u, "Emoji and pictographic Unicode symbols are forbidden in voice output."),
  f("control-character", /[\x00-\x08\x0B\x0C\x0E-\x1F]/u, "Control characters other than tab, newline, and carriage return are forbidden."),
  f(JSON_LEAK_RULE_ID, /a^/u, "JSON-like object leaks are forbidden unless enclosed in paired dialogue quotes."),
  f("code-block-indented-4space", /^(?: {4,}\S.*\n){1,} {4,}\S.*/mu, "Indented code blocks with two or more 4-space lines are forbidden."),
];

const ALLOWED_RULES: GrammarRule[] = [
  e("italian-apostrophe-word", /\b\w'\w/u),
  e("italian-virgolette", /[«»]/u),
  e("ellipsis-prose", /…|\.\.\./u),
  e("dialogue-dash-spaced", /\s[—–]\s/u),
  e("standalone-asterisk-mid-sentence", /\S\s\*\s\S/u),
  e("single-pipe-mid-sentence", /\S\s\|\s\S/u),
  e("hash-not-line-start", /\S#|#\d/u),
  e("quoted-dialogue-braces", /(['"«])[^'"«»]*\{[^{}]+\}[^'"«»]*(['"»])/u),
];

export function validate(text: string): ValidationResult {
  const exceptionSpans = collectExceptionSpans(text);
  const violations = FORBIDDEN_RULES.flatMap((rule) => collectViolations(text, rule)).filter(
    (violation) => !exceptionSpans.some((exception) => overlaps(violation, exception)),
  );

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

function f(id: string, regex: RegExp, description: string): GrammarRule {
  return { id, regex, description, kind: "forbidden" };
}

function e(id: string, regex: RegExp): GrammarRule {
  return { id, regex, description: id, kind: "allowed-exception" };
}

function collectExceptionSpans(text: string): Span[] {
  return ALLOWED_RULES.flatMap((rule) => {
    if (rule.id === "hash-not-line-start") {
      return collectHashExceptionSpans(text);
    }
    if (rule.id === "single-pipe-mid-sentence") {
      return collectSinglePipeExceptionSpans(text, rule.regex);
    }
    return collectRuleSpans(text, rule.regex);
  });
}

function collectHashExceptionSpans(text: string): Span[] {
  const spans: Span[] = [];

  for (const match of text.matchAll(/#\d/gu)) {
    if (match.index !== undefined) {
      spans.push({ offset: match.index, length: match[0].length });
    }
  }

  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === "#" && /\S/u.test(text[index - 1] ?? "") && text[index - 1] !== "#") {
      spans.push({ offset: index - 1, length: 2 });
    }
  }

  return spans;
}

function collectSinglePipeExceptionSpans(text: string, regex: RegExp): Span[] {
  return collectRuleSpans(text, regex).filter((span) => {
    const lineStart = text.lastIndexOf("\n", span.offset - 1) + 1;
    const nextLineBreak = text.indexOf("\n", span.offset);
    const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
    return [...text.slice(lineStart, lineEnd)].filter((char) => char === "|").length === 1;
  });
}

function collectViolations(text: string, rule: GrammarRule): Violation[] {
  const spans = rule.id === JSON_LEAK_RULE_ID ? collectJsonLeakSpans(text) : collectRuleSpans(text, rule.regex);
  return spans.map((span) => ({
    ruleId: rule.id,
    offset: span.offset,
    length: span.length,
    snippet: text.slice(span.offset, span.offset + span.length),
    description: rule.description,
  }));
}

function collectRuleSpans(text: string, regex: RegExp): Span[] {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const spans: Span[] = [];

  for (const match of text.matchAll(new RegExp(regex.source, flags))) {
    if (match.index !== undefined && match[0].length > 0) {
      spans.push({ offset: match.index, length: match[0].length });
    }
  }

  return spans;
}

function collectJsonLeakSpans(text: string): Span[] {
  const spans: Span[] = [];
  let quote: string | undefined;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    quote = updateQuoteState(quote, char, text[index - 1]);

    if (char !== "{" || quote !== undefined) {
      continue;
    }

    const block = readBalancedBraceBlock(text, index);
    if (block !== undefined && hasColonOutsideQuotes(block.content)) {
      spans.push({ offset: index, length: block.length });
      index += block.length - 1;
    }
  }

  return spans;
}

function readBalancedBraceBlock(text: string, start: number): { content: string; length: number } | undefined {
  let depth = 0;
  let quote: string | undefined;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    quote = updateQuoteState(quote, char, text[index - 1]);

    if (quote !== undefined) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content: text.slice(start + 1, index), length: index - start + 1 };
      }
    }
  }

  return undefined;
}

function hasColonOutsideQuotes(text: string): boolean {
  let quote: string | undefined;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    quote = updateQuoteState(quote, char, text[index - 1]);
    if (char === ":" && quote === undefined) {
      return true;
    }
  }

  return false;
}

function updateQuoteState(current: string | undefined, char: string | undefined, previous: string | undefined): string | undefined {
  if (char === undefined || previous === "\\") {
    return current;
  }

  if (current === undefined) {
    return char === "'" || char === '"' || char === "«" ? char : undefined;
  }

  if (current === "«" && char === "»") {
    return undefined;
  }

  return char === current ? undefined : current;
}

function overlaps(left: Span, right: Span): boolean {
  return left.offset < right.offset + right.length && right.offset < left.offset + left.length;
}
