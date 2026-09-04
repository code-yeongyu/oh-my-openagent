# Rule Authoring

Project rules are markdown files that OmO injects when the current file matches their frontmatter. Use them for repo-specific standards that should travel with the codebase: test discipline, API error handling, UI conventions, migration rules, or generated-file warnings.

## Where Rules Live

Prefer `.omo/rules/*.md` for OmO-native project rules.

Also discovered:

- `.claude/rules/*.md`
- `.cursor/rules/*.mdc`
- `.github/instructions/*.instructions.md`
- `.github/copilot-instructions.md`
- `CONTEXT.md`
- user rules under `~/.omo/rules`, `~/.opencode/rules`, and `~/.claude/rules`

Do not create new `.sisyphus/rules` files. That legacy location is only kept for compatibility in older paths.

## Frontmatter

Supported fields:

| Field | Type | Purpose |
|---|---|---|
| `description` | string | Human-readable summary shown with the rule. |
| `globs` | string or string[] | Primary OmO match patterns. |
| `paths` | string or string[] | Claude-compatible alias; normalized into `globs`. |
| `applyTo` | string or string[] | GitHub Copilot-compatible alias; normalized into `globs`. |
| `alwaysApply` | boolean | Apply the rule without checking glob patterns. |

`globs`, `paths`, and `applyTo` merge into one pattern list. You can mix them, but prefer one style per file so the rule is easy to audit.

## Template

```md
---
description: Error handling patterns for API routes
globs:
  - "src/api/**/*.ts"
  - "!src/api/**/*.test.ts"
---

# API Error Handling

- Return typed error responses from route handlers.
- Preserve the original error as structured diagnostic context.
- Do not swallow unexpected exceptions without logging or surfacing them.
```

Create the file as `.omo/rules/api-error-handling.md`.

## Matching Semantics

Rules are matched with picomatch-style globs. Paths are normalized to POSIX-style separators before matching, so write `/` separators even on Windows.

The matcher checks:

- the path relative to the project root
- the path relative to the scoped rule directory when available
- the basename, so patterns like `*.md` can match `docs/README.md`

Negative patterns start with `!` and exclude a target that matched a positive pattern.

Examples:

```yaml
globs:
  - "src/**/*.ts"
  - "!src/**/*.test.ts"
```

This applies to `src/index.ts` and skips `src/index.test.ts`.

```yaml
alwaysApply: true
```

This bypasses glob matching. Use it sparingly for repo-wide invariants.

## Discovery And Priority

For a target file, OmO walks up from that file's directory toward the project root and scans rule directories at each level. Closer rules have lower distance and are preferred when ordering the injected block.

Source ordering is deterministic:

1. `.omo/rules`
2. `.claude/rules`
3. `.cursor/rules`
4. `.github/instructions`
5. `.github/copilot-instructions.md`
6. `CONTEXT.md`
7. user-home rules
8. plugin-bundled rules

Single-file rules such as `.github/copilot-instructions.md` and `CONTEXT.md` apply without frontmatter.

## Authoring Checklist

- Put project-owned rules in `.omo/rules`.
- Give every rule a `description`.
- Prefer narrow `globs` over `alwaysApply`.
- Add negative globs for tests, generated files, or fixtures that should not inherit the rule.
- Keep the body actionable: requirements, forbidden patterns, and one short example beat broad philosophy.
- Split unrelated concerns into separate files so each rule can match only the files it actually governs.

## Quick Examples

Frontend rule:

```md
---
description: React component conventions
globs:
  - "src/**/*.tsx"
  - "packages/*/src/**/*.tsx"
---

# React Component Conventions

- Keep data loading outside presentational components.
- Use existing design tokens before adding local colors.
```

Docs rule:

```md
---
description: Documentation tone and link policy
applyTo:
  - "docs/**/*.md"
  - "*.md"
---

# Documentation Rules

- Prefer direct, testable claims.
- Link to the closest implementation source when describing behavior.
```
