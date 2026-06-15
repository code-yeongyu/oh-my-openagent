---
name: tech-debt-audit
description: "Thorough, file-cited technical debt audit across 9 dimensions using AST-grep (tree-sitter), grep, language-native tooling, and optionally CodeGraph knowledge graph. Produces TECH_DEBT_AUDIT.md with severity, effort estimates, and prioritized fixes. Use when asked for codebase health check, tech debt audit, architecture review, code quality assessment, or cleanup planning. Triggers: 'tech debt', 'technical debt', 'debt audit', 'code health', 'technical debt audit', 'codebase health check', 'find tech debt', 'debt analysis', 'audit code quality'."
---

# Tech Debt Audit Protocol

Model-agnostic technical debt audit for oh-my-openagent (OMO). Uses OMO's built-in tools (`ast_grep_search`, `grep`, `glob`, `bash`, `read`, `lsp_diagnostics`, `task`) plus **optional CodeGraph MCP** for enhanced code graph analysis when available. Produces a grounded, citable `TECH_DEBT_AUDIT.md` artifact.

## CodeGraph Enhancement (Optional)

If you have [CodeGraph](https://github.com/colbymchenry/codegraph) installed (check with `codegraph status`), its MCP tools (`codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_explore`, etc.) can supersede or augment the standard tool searches in the dimensions marked below. CodeGraph gives you:
- **Symbol search** — instant by-name lookup via FTS5
- **Call graph analysis** — callers/callees for any function
- **Impact analysis** — blast radius before changing any symbol
- **Smart context building** — entry points, related symbols, and snippets in one call
- **Framework-aware routes** — URL patterns linked to their handlers

To use CodeGraph, ensure the `codegraph` MCP server is configured in your project's `.mcp.json` or global MCP config. The skill will auto-detect CodeGraph by checking if `codegraph` MCP tools are available. Sub-agents spawned via `task()` cannot use CodeGraph — they use the standard tool fallback.

---

## Output

Write results to `TECH_DEBT_AUDIT.md` in the repo root with:

1. **Executive Summary** — 3-5 sentences: overall health, worst dimension, quick wins count
2. **Mental Model** — the repo's architecture in 1 paragraph (what it does, stack, module boundaries)
3. **Findings Table** — columns: ID, Category, File:Line, Severity (Critical/High/Medium/Low), Effort (Hours), Description, Recommendation
4. **Top 5 Priorities** — ranked by impact/effort ratio
5. **Quick Wins Checklist** — items under 30 minutes each
6. **"Looks Bad But Is Fine"** — patterns that look like debt but are intentional
7. **Open Questions** — things the maintainer should clarify

## Phase 0: Orient

### Standard (always run)
1. `glob("**/*.ts")` / `glob("**/*.py")` / etc — map the language stack
2. `glob("**/package.json")` + `read()` — dependencies and build tooling
3. `bash("git log --oneline -200")` — churn: find highest-change files
4. `glob("**/*")` + basic math — find largest files (>300 LOC are candidates)
5. Cross-reference high-churn + large = debt hot zones
6. Write the mental model paragraph in your own working context

### CodeGraph Enhancement (if available)
Instead of guessing module boundaries, query the code graph:

```
codegraph_explore(query="architecture overview and main modules")
```
This returns symbol relationships and source grouped by file. Use the structure as your architectural mental model instead of hand-inferring it from directory names.

```
codegraph_explore(query="main entry points and execution flow")
```
This surfaces entry points and call chains. Use these to understand how the code actually flows vs how the directory layout suggests it flows.

## Phase 1: Audit Across 9 Dimensions

Use OMO tools for each dimension. Run parallel tool calls within each dimension. Every finding MUST cite `file:line:col`.

### 1. Architectural Decay

#### Standard (always run)
- `ast_grep_search(pattern="import { $$$ } from '$SRC'", lang="typescript")` — map module graph, look for circular patterns
- `ast_grep_search(pattern="class $NAME { $$$ }", lang="typescript")` — check for god classes
- `grep("TODO|FIXME|HACK|XXX|WORKAROUND|TEMP")` — tagged debt markers
- `grep("async|await")` on sync-looking files — misplaced async boundaries
- `bash("wc -l <file>")` on each large file found in Phase 0

#### CodeGraph Enhancement (if available)

**Dead code detection:**
```
codegraph_callers(symbol="<suspected-dead-function>")
codegraph_callers(symbol="<suspected-dead-class>")
```
Run `codegraph_callers` on suspected dead exports found via grep/glob. If the result shows zero callers (excluding test files), it's dead code.

**Circular dependency detection:**
```
codegraph_impact(target="<module-or-file>", direction="upstream")
```
Use `codegraph_impact` on key modules to trace their dependents. If A depends on B and B depends on A, that's a cycle.

**Architecture boundaries:**
```
codegraph_explore(query="module dependencies and architecture boundaries")
```
Use `codegraph_explore` to survey actual module structure.

#### What to flag
- Files > 500 LOC (god files)
- Functions > 80 LOC or > 4 nesting levels
- Classes with > 15 methods or > 400 LOC
- Import cycles (A → B → A)
- Dead exports: function/class defined but never imported elsewhere (CodeGraph: `codegraph_callers`)
- Commented-out code blocks (>3 consecutive consecutive lines)

### 2. Consistency Rot

#### Standard (always run)
- `ast_grep_search(pattern="import axios|import fetch|import got|import superagent", lang="typescript")` — multiple HTTP clients
- `grep("console.log|console.error|console.warn")` — direct console use vs logger
- `ast_grep_search(pattern="try { $$$ } catch ($$$) { $$$ }", lang="typescript")` — error handling patterns
- `grep("as any|@ts-ignore|@ts-expect-error|as unknown")` — type escapes
- `grep("eslint-disable|prettier-ignore")` — lint suppressions

#### What to flag
- 3+ ways of doing the same thing (HTTP, logging, validation, config)
- Mixed naming conventions (camelCase + snake_case + PascalCase)
- Multiple date/time handling libraries
- Mixed error response shapes across modules

### 3. Type & Contract Debt

#### Standard (always run)
- `ast_grep_search(pattern="as any", lang="typescript")` — runtime type escapes
- `ast_grep_search(pattern="@ts-expect-error", lang="typescript")` — suppressed errors
- `ast_grep_search(pattern="@ts-ignore", lang="typescript")` — suppressed errors (legacy)
- `ast_grep_search(pattern=": any", lang="typescript")` — typed as any
- `lsp_diagnostics(filePath="<src-dir>")` — current type errors

#### What to flag
- `any` types on public APIs and exported interfaces
- Untyped function parameters
- Missing schema validation at API/IO boundaries
- LSP type errors grouped by file

### 4. Test Debt

#### Standard (always run)
- `glob("**/*.test.ts")` — find all test files
- `bash("bun test 2>&1 | grep -E '(fail|skip|todo)'")` — current test health
- Cross-reference Phase 0 high-churn files with test existence

#### What to flag
- Critical-path files with zero tests
- Skipped tests (`test.skip`, `describe.skip`)
- Tests asserting implementation details vs behavior
- Slow tests (>1s each)

### 5. Dependency & Config Debt

#### Standard (always run)
- `bash("npm audit --omit=dev 2>&1 | head -40")` — known CVEs (if node_modules present)
- `read("package.json")` — check dependency count and stale deps
- `grep(".env|process.env|Bun.env")` — env var usage
- `grep("API_KEY|SECRET|PASSWORD|TOKEN")` in non-config files — hardcoded config

#### CodeGraph Enhancement (if available)

**Blast radius of core dependencies:**
```
codegraph_impact(target="<core-utility-function>", direction="upstream")
```
Run this on a few key internal modules (logger, config loader, HTTP client) to see how widely they're used. A widely-depended-on module with poor error handling or type safety is a high-priority refactor target because changes to it ripple everywhere.

#### What to flag
- Outdated major-version deps
- Dependencies that do the same thing (duplicate libraries)
- Referenced env vars not documented in README
- Hardcoded environment-specific values

### 6. Performance & Resource Hygiene

#### Standard (always run)
- `ast_grep_search(pattern="for ($$$ of $$$) { $$$ await $$$ }", lang="typescript")` — async-in-loop
- `grep("await.*map|await.*filter|await.*forEach")` — sequential async iteration
- `grep("Promise\\.all|Promise\\.allSettled")` — existing parallel patterns (good signal)
- `grep("addEventListener|on\\(|subscribe")` without `removeEventListener|off\\(|unsubscribe` nearby — listener hygiene

#### What to flag
- `await` inside `for/of` loops (sequential when parallel possible)
- N+1 query patterns
- Missing cleanup on event listeners, intervals, handles
- Unnecessary serialization/deserialization

### 7. Error Handling & Observability

#### Standard (always run)
- `ast_grep_search(pattern="catch ($$$) { $$$ }", lang="typescript")` — catch blocks
- `grep("catch.*{}|catch.*{\\s*}")` — empty catch blocks
- `grep("console.error|logger\\.error|log\\.error")` — actual error logging
- `ast_grep_search(pattern="throw new $ERR(", lang="typescript")` — error types used

#### CodeGraph Enhancement (if available)

**Trace error propagation through call chains:**
```
codegraph_callers(symbol="<key-error-handler-or-middleware>")
codegraph_explore(query="how errors propagate through <key-error-handler>")
```
Use `codegraph_callers` to find who calls your error handlers. If errors are caught and swallowed at multiple levels, that's a finding.

**Impact of changing error types:**
```
codegraph_impact(target="<error-class-or-interface>", direction="upstream")
```
Check the blast radius of custom error classes. If changing an error type would break 20+ consumers, the error contract is too tight.

#### What to flag
- Empty catch blocks (worst offense)
- Generic `catch (e) { console.error(e) }` without recovery
- Inconsistent error shapes across modules
- Missing structured logging on critical paths
- Errors swallowed in promise chains (`.catch(() => {})`)

### 8. Security Hygiene

#### Standard (always run)
- `grep("api[Kk]ey|api_secret|password|secret|token|credential")` in source files (not config or env)
- `ast_grep_search(pattern="SELECT .* FROM|INSERT INTO|UPDATE.*SET|DELETE FROM", lang="typescript")` — SQL construction
- `ast_grep_search(pattern="innerHTML|dangerouslySetInnerHTML", lang="typescript")` — XSS vectors
- `grep("eval\\(|Function\\(|setTimeout\\(.*string|setInterval\\(.*string")` — code injection

#### What to flag
- Hardcoded secrets in source
- String-concatenated SQL
- `innerHTML` / `dangerouslySetInnerHTML` usage
- `eval()` or string-based `setTimeout`/`setInterval`
- Permissive CORS or auth middleware

### 9. Documentation Drift

#### Standard (always run)
- `read("README.md")` — check if claims match reality
- `grep("@param|@returns|@throws")` — docstring coverage
- `grep("FIXME|TODO|HACK|XXX|WORKAROUND")` — fixme density
- Compare README API examples with actual signatures

#### What to flag
- README claiming features that don't exist
- Public functions without any doc comment
- Comments that contradict the code
- Stale architecture decision records (ADRs) if present

## Phase 2: Deeper Dives (Parallel Sub-Agents)

For large codebases (>50k LOC), delegate heavy dimensions to parallel sub-agents. Sub-agents CANNOT use CodeGraph — they use standard tools only:

```
task(category="unspecified-low", run_in_background=true, load_skills=[], prompt="[CONTEXT] Tech debt audit. [GOAL] Audit dimensions 1 (Architecture) and 2 (Consistency). [REQUEST] Run ast_grep and grep searches for dimensions 1-2 from the tech-debt-audit skill. Report every finding with file:line:col. Tag severity: Critical/High/Medium/Low.")
task(category="unspecified-low", run_in_background=true, load_skills=[], prompt="[CONTEXT] Tech debt audit. [GOAL] Audit dimensions 3 (Type debt) and 7 (Error handling). [REQUEST] Run searches for dimensions 3 and 7 from the tech-debt-audit skill. Report every finding with file:line:col. Tag severity.")
```

Spawn 2-3 sub-agents for the heaviest dimensions, collect results in parallel, then synthesize. The main agent handles CodeGraph queries itself while sub-agents run the standard tool passes.

## Phase 3: Synthesize & Deliver

1. Collect all findings from direct tool calls, CodeGraph queries (if available), and sub-agent results
2. Deduplicate — same issue mentioned by multiple dimensions
3. Classify severity:
   - **Critical** — Causes incorrect behavior, data loss, or security vulnerability
   - **High** — Will cause problems in production; blocks maintenance
   - **Medium** — Reduces maintainability; violates conventions
   - **Low** — Cosmetic; should fix when in the area
4. Estimate effort in hours per finding (conservative)
5. Write `TECH_DEBT_AUDIT.md` with all required sections
6. Report summary to the user

## Severity Rubric

```
Critical = actively causing bugs or security holes
High     = will cause problems under normal operation; blocks changes
Medium   = reduces maintainability; inconsistent; violates team conventions
Low      = cosmetic; would be nice to fix when nearby
```

## Quick Checks Before Finishing

- [ ] Every concrete finding has `file:line:col` citation
- [ ] No generic claims without evidence
- [ ] "Looks Bad But Is Fine" section explains at least 2-3 patterns
- [ ] Top 5 priorities ranked by impact/effort
- [ ] Quick wins are things that can be fixed in <30 minutes each
