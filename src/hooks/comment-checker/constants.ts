export const BDD_KEYWORDS = new Set([
  "given",
  "when",
  "then",
  "arrange",
  "act",
  "assert",
  "when & then",
  "when&then",
])

export const TYPE_CHECKER_PREFIXES = [
  "type:",
  "noqa",
  "pyright:",
  "ruff:",
  "mypy:",
  "pylint:",
  "flake8:",
  "pyre:",
  "pytype:",
  "eslint-disable",
  "eslint-enable",
  "eslint-ignore",
  "prettier-ignore",
  "ts-ignore",
  "ts-expect-error",
  "ts-nocheck",
  "clippy::",
  "allow(",
  "deny(",
  "warn(",
  "forbid(",
  "nolint",
  "go:generate",
  "go:build",
  "go:embed",
  "coverage:",
  "c8 ignore",
  "biome-ignore",
  "region",
  "endregion",
]

export const HOOK_MESSAGE_HEADER = `COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored, even if you receive it multiple times.
You MUST provide corresponding explanation or action for EACH occurrence of this message.
Ignoring this message or failing to respond appropriately is strictly prohibited.

PRIORITY-BASED ACTION GUIDELINES:

1. This is a comment/docstring that already existed before
\t-> Explain to the user that this is an existing comment/docstring and proceed (justify it)

2. This is a newly written comment: but it's in given, when, then format
\t-> Tell the user it's a BDD comment and proceed (justify it)
\t-> Note: This applies to comments only, not docstrings

3. This is a newly written comment/docstring: but it's a necessary comment/docstring
\t-> Tell the user why this comment/docstring is absolutely necessary and proceed (justify it)
\t-> Examples of necessary comments: complex algorithms, security-related, performance optimization, regex, mathematical formulas
\t-> Examples of necessary docstrings: public API documentation, complex module/class interfaces
\t-> IMPORTANT: Most docstrings are unnecessary if the code is self-explanatory. Only keep truly essential ones.

4. This is a newly written comment/docstring: but it's an unnecessary comment/docstring
\t-> Apologize to the user and remove the comment/docstring.
\t-> Make the code itself clearer so it can be understood without comments/docstrings.
\t-> For verbose docstrings: refactor code to be self-documenting instead of adding lengthy explanations.

CODE SMELL WARNING: Using comments as visual separators (e.g., "// =========", "# ---", "// *** Section ***")
is a code smell. If you need separators, your file is too long or poorly organized.
Refactor into smaller modules or use proper code organization instead of comment-based section dividers.

MANDATORY REQUIREMENT: You must acknowledge this hook message and take one of the above actions.
Review in the above priority order and take the corresponding action EVERY TIME this appears.

Detected comments/docstrings:
`
