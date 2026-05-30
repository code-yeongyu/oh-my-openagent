export const AST_GREP_SEARCH_DESCRIPTION = [
  "Search code by AST structure (25 languages). This is NOT regex.",
  "",
  "Meta-variables (the only wildcards ast-grep understands):",
  "  $VAR       - one AST node (an identifier, expression, statement, ...)",
  "  $$$        - zero or more nodes (argument lists, function bodies, ...)",
  "  $$$VAR     - same, captured by name",
  "Patterns must be complete, parseable source code. Each meta-variable replaces a whole node, not a substring.",
  "",
  "Regex syntax does NOT work - never pass these to pattern:",
  '  "foo|bar"      alternation → run separate calls, or switch to grep',
  '  ".*", ".+"     wildcards   → use $$$ between AST fragments',
  '  "\\w", "\\d"    escapes     → use $VAR to capture any identifier',
  '  "[a-z]"        class ranges → no AST equivalent',
  "For text search, cross-language search, or regex features, use the grep tool instead.",
  "",
  "Examples by language:",
  '  typescript/tsx  "function $NAME($$$) { $$$ }", "console.log($$$)", "import { $$$ } from \'$MOD\'"',
  '  python          "def $FUNC($$$)", "class $C($$$)"          - no trailing colon',
  '  go              "func $NAME($$$) { $$$ }", "if err != nil { $$$ }"',
  '  rust            "fn $NAME($$$) -> $RET { $$$ }", "impl $TRAIT for $T { $$$ }"',
  "",
  "On empty results the tool returns a hint naming the exact mistake. If the pattern is fundamentally text-shaped, stop retrying and switch to grep.",
].join("\n")

export const AST_GREP_SEARCH_PATTERN_PARAM =
  "AST pattern - valid, parseable code using $VAR (one node) and $$$ (many nodes). NOT regex: no `|`, no `.*`, no `\\w`, no `[a-z]`. For text or alternation, use grep instead."

export const AST_GREP_REPLACE_DESCRIPTION = [
  "Rewrite code by AST pattern (25 languages). Dry-run by default.",
  "Both pattern and rewrite use AST syntax ($VAR for one node, $$$ for many) - regex does NOT work.",
  "Meta-variables captured in pattern can be reused in rewrite to preserve matched content.",
  'Example: pattern="console.log($MSG)" rewrite="logger.info($MSG)"',
  "For text-only replacement or regex features, use a text editor instead.",
].join("\n")
