import type { GrammarRule } from "./types";

export const FORBIDDEN_PATTERNS: GrammarRule[] = [
  {
    id: "code-fence-triple-backtick",
    regex: /(^```|^~~~|```)/mu,
    description: "Triple backtick or tilde code fences are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "code-span-single-backtick",
    regex: /`[^`\n]+`/u,
    description: "Single backtick code spans are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-heading-h1",
    regex: /^#\s+\S/mu,
    description: "Markdown H1 headings are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-heading-h2",
    regex: /^##\s+\S/mu,
    description: "Markdown H2 headings are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-heading-h3",
    regex: /^###\s+\S/mu,
    description: "Markdown H3 headings are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-heading-h4",
    regex: /^####\s+\S/mu,
    description: "Markdown H4 headings are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-heading-h5",
    regex: /^#####\s+\S/mu,
    description: "Markdown H5 headings are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-heading-h6",
    regex: /^######\s+\S/mu,
    description: "Markdown H6 headings are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-list-dash",
    regex: /^-\s+/mu,
    description: "Dash bullet lists are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-list-asterisk",
    regex: /^\*\s+/mu,
    description: "Asterisk bullet lists are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-list-plus",
    regex: /^\+\s+/mu,
    description: "Plus bullet lists are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-list-numbered",
    regex: /^\d+\.\s+/mu,
    description: "Numbered Markdown lists are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-table",
    regex: /^\|.*\|$\n^\|[-:|\s]+\|$/mu,
    description: "Markdown table rows followed by separator rows are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-link",
    regex: /\[[^\]]+\]\([^)]+\)/u,
    description: "Markdown links are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "markdown-image",
    regex: /!\[[^\]]*\]\([^)]+\)/u,
    description: "Markdown images are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "emoji-unicode",
    regex: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F900}-\u{1F9FF}]/u,
    description: "Emoji and pictographic Unicode symbols are forbidden in voice output.",
    kind: "forbidden",
  },
  {
    id: "control-character",
    regex: /[\x00-\x08\x0B\x0C\x0E-\x1F]/u,
    description: "Control characters other than tab, newline, and carriage return are forbidden.",
    kind: "forbidden",
  },
  {
    id: "json-leak-heuristic",
    regex: /(^|[^'\"«])\{\s*['\"]?[^{}'\"\n]+['\"]?\s*:\s*[^{}]+\}([^'\"»]|$)/u,
    description: "JSON-like object leaks are forbidden unless enclosed in paired dialogue quotes.",
    kind: "forbidden",
  },
  {
    id: "code-block-indented-4space",
    regex: /^(?: {4,}\S.*\n){1,} {4,}\S.*/mu,
    description: "Indented code blocks with two or more 4-space lines are forbidden.",
    kind: "forbidden",
  },
];

export const ALLOWED_EXCEPTIONS: GrammarRule[] = [
  {
    id: "italian-apostrophe-word",
    regex: /\b\w'\w/u,
    description: "Italian apostrophes inside words are allowed.",
    kind: "allowed-exception",
  },
  {
    id: "italian-virgolette",
    regex: /[«»]/u,
    description: "Italian guillemet quotation marks are allowed.",
    kind: "allowed-exception",
  },
  {
    id: "ellipsis-prose",
    regex: /…|\.\.\./u,
    description: "Ellipses are allowed in prose when not starting a code block.",
    kind: "allowed-exception",
  },
  {
    id: "dialogue-dash-spaced",
    regex: /\s[—–]\s/u,
    description: "Spaced em-dashes and en-dashes are allowed in dialogue prose.",
    kind: "allowed-exception",
  },
  {
    id: "standalone-asterisk-mid-sentence",
    regex: /\S\s\*\s\S/u,
    description: "Standalone asterisks are allowed mid-sentence when not at line start.",
    kind: "allowed-exception",
  },
  {
    id: "single-pipe-mid-sentence",
    regex: /\S\s\|\s\S/u,
    description: "Single pipes are allowed mid-sentence when not forming a Markdown table.",
    kind: "allowed-exception",
  },
  {
    id: "hash-not-line-start",
    regex: /\S#|#\d/u,
    description: "Hash characters are allowed when they do not start a Markdown heading.",
    kind: "allowed-exception",
  },
  {
    id: "quoted-dialogue-braces",
    regex: /(['\"«])[^'\"«»]*\{[^{}]+\}[^'\"«»]*(['\"»])/u,
    description: "Braces are allowed inside paired quoted dialogue.",
    kind: "allowed-exception",
  },
];
