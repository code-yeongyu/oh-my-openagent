// pattern-hints.ts — pattern validation + metavariable analysis for ast-grep
// Ported from packages/shared-skills/skills/ast-grep/scripts/ast_grep_helper.py

// ---- types ----

export type HintSeverity = "warn" | "reject" | "always-reject";

export interface Hint {
  code: string;
  severity: HintSeverity;
  message: string;
}

export interface ValidationOpts {
  force?: boolean;
  paths?: unknown;
  limit?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  rejected: boolean;
  code: string | null;
  hints: Hint[];
}

export interface MetavarSet {
  single: Set<string>;
  multi: Set<string>;
}

// ---- constants: 25 canonical languages + aliases ----

const LANGUAGES = new Set([
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
]);

const LANG_ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", py: "python",
  py3: "python", rb: "ruby", rs: "rust", kt: "kotlin", ex: "elixir",
  hs: "haskell", sh: "bash", zsh: "bash", cc: "cpp", "c++": "cpp",
  cxx: "cpp", cs: "csharp", yml: "yaml", sol: "solidity", golang: "go",
};

// ---- regex constants ----

const RE_BACKSLASH = /\\w|\\d|\\s|\\b/;
const RE_DOT_STAR = /(?<!\$)\.\*|(?<!\$)\.\+/;
// Detects regex character classes using a strict decision table:
//   FIRE only when ALL hold:
//   1. the ENTIRE trimmed pattern is a single bracket expression: ^\[^?[^\]]+\]$
//   2. it does NOT contain a comma (tuples, arrays, destructuring have commas)
//   3. it has at least one regex-class indicator: an alnum-to-alnum range
//      hyphen ([a-z], [A-Z], [0-9]), a leading caret (^), or one of _ . or space
//      among the inner chars
//   This prevents false positives on valid code like [a, b], obj[foo_bar],
//   type T = [A, B], arr[0], obj["key"].
function isRegexCharClass(pattern: string): boolean {
  const trimmed = pattern.trim();
  // Rule 1: entire pattern is a single bracket expression with optional caret INSIDE
  if (!/^\[\^?[^\]]+\]$/.test(trimmed)) return false;
  // Extract inner contents (after optional leading caret inside brackets)
  const inner = trimmed.replace(/^\[\^?/, "").replace(/\]$/, "");
  // Rule 2: no comma
  if (inner.includes(",")) return false;
  // Rule 3: at least one regex-class indicator
  // 3a: any alnum-to-alnum range hyphen ([a-z], [A-Z], [0-9], [0-Z])
  if (/[a-zA-Z0-9]-[a-zA-Z0-9]/.test(inner)) return true;
  // 3b: leading caret inside brackets (negated class like [^a-z])
  if (/^\[\^/.test(trimmed)) return true;
  // 3c: underscore, dot, or space among inner chars
  if (/[_. ]/.test(inner)) return true;
  return false;
}
const RE_DOUBLE_DOLLAR = /(?<!\$)\$\$(?!\$)[A-Za-z_]/;
// Matches any metavar-shaped token $[A-Za-z_][A-Za-z0-9_]* that is NOT valid:
// valid = $_ (wildcard) or $[A-Z][A-Z0-9_]* (all caps). Invalid = mixed-case like $Foo, $Afoo.
// We scan for all $-tokens and check each one.
const RE_ANY_METAVAR = /(?<!\$)\$(?!\$)([A-Za-z_][A-Za-z0-9_]*)/g;

const RE_PY_TRAILING_COLON = /^\s*(?:def|class)\s+\$?\w+[^:]*:\s*$/m;
// Incomplete function forms: declaration with optional params but NO body braces.
// Matches both name-only ("function foo") and params-but-no-body ("function foo()").
const RE_JS_INCOMPLETE = /^\s*(?:async\s+)?function\s+\$?\w+(?:\([^)]*\))?\s*$/m;
const RE_GO_INCOMPLETE = /^\s*func\s+\$?\w+(?:\([^)]*\))?\s*$/m;
const RE_RUST_INCOMPLETE = /^\s*fn\s+\$?\w+(?:\([^)]*\))?\s*$/m;

// ---- helpers ----

function normalizeLanguage(lang: string): string | null {
  if (typeof lang !== "string") return null;
  const lower = lang.toLowerCase();
  const canonical = LANG_ALIASES[lower] ?? lower;
  return LANGUAGES.has(canonical) ? canonical : null;
}

function findAlternation(pattern: string): boolean {
  const stripped = pattern.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "");
  if (stripped.includes("||")) return false;
  // Warn when `|` separates: word chars, metavar tokens ($A), or call expressions foo()
  // Covers: a|b, $A | $B, foo() | bar()
  return /(?:\w|\$\w+|\w+\(\))\s*\|\s*(?:\w|\$\w+|\w+\(\))/.test(stripped);
}

function isValidPaths(paths: unknown): boolean {
  if (!Array.isArray(paths)) return false;
  if (paths.length === 0) return false;
  return paths.every((p) => typeof p === "string" && p.length > 0);
}

function isValidLimit(limit: unknown): boolean {
  return typeof limit === "number" && Number.isFinite(limit) && Number.isInteger(limit) && limit > 0;
}

// ---- public API: extractMetavars ----

export function extractMetavars(text: string): MetavarSet {
  const single = new Set<string>();
  const multi = new Set<string>();

  const reMulti = /\$\$\$([A-Z][A-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = reMulti.exec(text)) !== null) {
    multi.add(m[1]);
  }

  const reSingle = /(?<!\$)\$(?!\$)([A-Z][A-Z0-9_]*)/g;
  while ((m = reSingle.exec(text)) !== null) {
    single.add(m[1]);
  }

  return { single, multi };
}

// ---- public API: validatePatternHints ----

export function validatePatternHints(
  pattern: string,
  language: string,
  opts: ValidationOpts = {},
): ValidationResult {
  const force = opts.force ?? false;
  const hints: Hint[] = [];

  // --- always-reject checks ---

  if (pattern.trim().length === 0) {
    hints.push({ code: "PATTERN_EMPTY", severity: "always-reject", message: "Pattern is empty." });
  }

  const canonical = normalizeLanguage(language);
  if (canonical === null) {
    hints.push({
      code: "LANGUAGE_UNSUPPORTED",
      severity: "always-reject",
      message: `Language '${language}' is not supported. Use one of the 25 ast-grep languages.`,
    });
  }

  if (opts.paths !== undefined && !isValidPaths(opts.paths)) {
    hints.push({ code: "INVALID_PATH", severity: "always-reject", message: "Paths must be a non-empty array of non-empty strings." });
  }

  if (opts.limit !== undefined && !isValidLimit(opts.limit)) {
    hints.push({ code: "INVALID_LIMIT", severity: "always-reject", message: "Limit must be a positive finite integer." });
  }

  // If any always-reject, return immediately
  const alwaysReject = hints.find((h) => h.severity === "always-reject");
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints };
  }

  // --- hard-reject checks (collected always, reject only if !force) ---

  if (RE_BACKSLASH.test(pattern)) {
    hints.push({
      code: "REGEX_BACKSLASH_ESCAPE",
      severity: "reject",
      message: "Backslash escapes (\\w, \\d, \\s, \\b) are regex, not ast-grep. Use $VAR for identifiers.",
    });
  }

  if (RE_DOT_STAR.test(pattern)) {
    hints.push({
      code: "REGEX_DOT_STAR",
      severity: "reject",
      message: "'.*' and '.+' are regex wildcards. Use $$$ for multiple nodes or $VAR for one.",
    });
  }

  if (isRegexCharClass(pattern)) {
    hints.push({
      code: "REGEX_CHAR_CLASS",
      severity: "reject",
      message: "Character classes like [a-z] are regex syntax. ast-grep has no AST equivalent.",
    });
  }

  // Language-specific incomplete forms
  if (canonical === "python" && RE_PY_TRAILING_COLON.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Python pattern has trailing ':'. Drop the colon: 'def $FUNC($$$)' or 'class $C($$$)'.",
    });
  }
  if ((canonical === "javascript" || canonical === "typescript" || canonical === "tsx") && RE_JS_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "JS/TS function pattern is incomplete. Add params and body: 'function $NAME($$$) { $$$ }'.",
    });
  }
  if (canonical === "go" && RE_GO_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Go function pattern is incomplete. Add params and body: 'func $NAME($$$) { $$$ }'.",
    });
  }
  if (canonical === "rust" && RE_RUST_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Rust fn pattern is incomplete. Add params and body: 'fn $NAME($$$) -> $RET { $$$ }'.",
    });
  }

  if (RE_DOUBLE_DOLLAR.test(pattern)) {
    hints.push({
      code: "METAVAR_DOUBLE_DOLLAR",
      severity: "reject",
      message: "$$NAME is invalid. Use $$$NAME for multi-node capture or $NAME for single.",
    });
  }

  // Check every metavar-shaped token: must be $_ or ALL-CAPS
  let m: RegExpExecArray | null;
  RE_ANY_METAVAR.lastIndex = 0;
  while ((m = RE_ANY_METAVAR.exec(pattern)) !== null) {
    const name = m[1];
    if (name === "_") continue; // $_ wildcard is valid
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      hints.push({
        code: "INVALID_METAVAR_NAME",
        severity: "reject",
        message: `Metavariable name $${name} must be UPPERCASE (e.g. $${name.toUpperCase()}) or use $_ for wildcard.`,
      });
      break; // one hint per pattern
    }
  }

  // --- warn-only checks (never reject) ---

  if (findAlternation(pattern)) {
    hints.push({
      code: "BARE_ALTERNATION",
      severity: "warn",
      message: "Literal '|' may be a TS union or bitwise-or. If regex alternation, use separate calls.",
    });
  }

  // --- determine result ---

  const hardReject = hints.find((h) => h.severity === "reject");
  if (hardReject && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints };
  }

  return { ok: true, rejected: false, code: null, hints };
}

// ---- public API: validateRewriteHints ----

export function validateRewriteHints(
  pattern: string,
  rewrite: string,
  language: string,
  opts: ValidationOpts = {},
): ValidationResult {
  const force = opts.force ?? false;

  // Validate pattern first
  const patternResult = validatePatternHints(pattern, language, opts);
  const hints = [...patternResult.hints];

  // If pattern has always-reject (not PATTERN_HINT_REJECTED), return immediately
  if (patternResult.rejected && patternResult.code !== "PATTERN_HINT_REJECTED") {
    return patternResult;
  }

  // --- rewrite-specific always-reject checks ---

  const pm = extractMetavars(pattern);
  const rm = extractMetavars(rewrite);
  const patternNames = new Set([...pm.single, ...pm.multi]);
  const rewriteNames = new Set([...rm.single, ...rm.multi]);

  // Unbound metavariable in rewrite
  for (const name of rewriteNames) {
    if (!patternNames.has(name)) {
      hints.push({
        code: "REWRITE_UNBOUND_METAVARIABLE",
        severity: "always-reject",
        message: `Rewrite uses metavariable $${name} not captured by pattern.`,
      });
      break;
    }
  }

  // Cardinality mismatch (only for bound names)
  for (const name of rewriteNames) {
    if (!patternNames.has(name)) continue;
    const pSingle = pm.single.has(name);
    const pMulti = pm.multi.has(name);
    const rSingle = rm.single.has(name);
    const rMulti = rm.multi.has(name);
    if ((pSingle && !pMulti && rMulti && !rSingle) || (pMulti && !pSingle && rSingle && !rMulti)) {
      hints.push({
        code: "REWRITE_CARDINALITY_MISMATCH",
        severity: "always-reject",
        message: `Metavariable ${name} cardinality mismatch between pattern and rewrite.`,
      });
      break;
    }
  }

  // --- determine result ---

  const alwaysReject = hints.find((h) => h.severity === "always-reject");
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints };
  }

  // Pattern hard-reject (propagate if not force)
  if (patternResult.rejected && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints };
  }

  return { ok: true, rejected: false, code: null, hints };
}
