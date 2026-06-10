---
name: tech-debt-audit
description: "Thorough, file-cited technical debt audit across 9 dimensions using AST-grep (tree-sitter), grep, language-native tooling, and optionally GitNexus knowledge graph. Produces TECH_DEBT_AUDIT.md with severity, effort estimates, and prioritized fixes. Use when asked for codebase health check, tech debt audit, architecture review, code quality assessment, or cleanup planning. Triggers: 'tech debt', 'technical debt', 'debt audit', 'code health', 'technical debt audit', 'codebase health check', 'find tech debt', 'debt analysis', 'audit code quality'."
---

# Tech Debt Audit Protocol

Model-agnostic technical debt audit for oh-my-openagent (OMO). Uses OMO's built-in tools (`ast_grep_search`, `grep`, `glob`, `bash`, `read`, `lsp_diagnostics`, `task`) plus **optional GitNexus knowledge graph** (`gitnexus_list_repos`, `gitnexus_query`, `gitnexus_cypher`, `gitnexus_context`, `gitnexus_impact`) when available. Produces a grounded, citable `TECH_DEBT_AUDIT.md` artifact.

## GitNexus Enhancement (Optional)

When running as the lead orchestrator (not a sub-agent), check if GitNexus tools are available (they register when `gitnexus.server_url` is set in config) AND whether the current repo is indexed:

```
gitnexus_list_repos()
```

If the current repo appears in the results, GitNexus is available. Use it to **supersede or augment** the standard tool searches in the dimensions marked below. GitNexus gives you:
- **Dead code detection** — Cypher query for functions/classes with zero callers
- **Architecture communities** — Leiden algorithm clusters showing actual module boundaries
- **Circular dependency tracing** — Graph cycles via Cypher path queries
- **Blast radius analysis** — Impact of changing any symbol
- **Execution flow traces** — Full call chains from entry point to terminal

When GitNexus is available, run GitNexus queries directly. Sub-agents spawned via `task()` cannot use GitNexus — they use the standard tool fallback.

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

### GitNexus Enhancement (if available)
Instead of guessing module boundaries from file paths, query the actual architecture:

```
gitnexus_query(query="current repo architecture and module structure", repo="<repo-name>")
```
This returns communities (functional areas) detected by the Leiden algorithm. Use the community structure as your architectural mental model instead of hand-inferring it from directory names.

```
gitnexus_query(query="execution flows and entry points", repo="<repo-name>")
```
This returns processes (execution traces from entry to terminal). Use these to understand how the code actually flows vs how the directory layout suggests it flows.

## Phase 1: Audit Across 9 Dimensions

Use OMO tools for each dimension. Run parallel tool calls within each dimension. Every finding MUST cite `file:line:col`.

### 1. Architectural Decay

#### Standard (always run)
- `ast_grep_search(pattern="import { $$$ } from '$SRC'", lang="typescript")` — map module graph, look for circular patterns
- `ast_grep_search(pattern="class $NAME { $$$ }", lang="typescript")` — check for god classes
- `grep("TODO|FIXME|HACK|XXX|WORKAROUND|TEMP")` — tagged debt markers
- `grep("async|await")` on sync-looking files — misplaced async boundaries
- `bash("wc -l <file>")` on each large file found in Phase 0

#### GitNexus Enhancement (if available)

**Dead code detection:**
```
gitnexus_cypher(query="MATCH (f:Function) WHERE NOT (f)<-[:CodeRelation {type: 'CALLS'}]-(:Function) RETURN f.name, f.filePath, f.startLine", repo="<repo-name>")
gitnexus_cypher(query="MATCH (c:Class) WHERE NOT (c)<-[:CodeRelation {type: 'EXTENDS'}]-(:Class) AND NOT (c)<-[:CodeRelation {type: 'IMPLEMENTS'}]-(:Class) AND NOT (c)<-[:CodeRelation {type: 'HAS_METHOD'}]-(:Method) RETURN c.name, c.filePath", repo="<repo-name>")
```
These find functions that nothing calls and classes that nothing extends/implements/has-methods-on. Cross-reference with test files — if they're only used in tests, they're test utilities, not dead code.

**Circular dependency detection:**
```
gitnexus_cypher(query="MATCH p=(a)-[:CodeRelation {type: 'IMPORTS'}]->(b)-[:CodeRelation {type: 'IMPORTS'}]->(a) RETURN a.name, a.filePath, b.name, b.filePath LIMIT 20", repo="<repo-name>")
```
For deeper cycles:
```
gitnexus_cypher(query="MATCH p=(a)-[:CodeRelation {type: 'IMPORTS'}]->(b)-[:CodeRelation {type: 'IMPORTS'}]->(c)-[:CodeRelation {type: 'IMPORTS'}]->(a) RETURN a.filePath, b.filePath, c.filePath LIMIT 20", repo="<repo-name>")
```

**God module detection via community cohesion:**
```
gitnexus_query(query="communities with low cohesion indicating misplaced code", repo="<repo-name>", goal="find architectural decay", task_context="tech debt audit")
```
Communities with low cohesion scores suggest code that's in the wrong module — a strong architectural decay signal.

#### What to flag
- Files > 500 LOC (god files)
- Functions > 80 LOC or > 4 nesting levels
- Classes with > 15 methods or > 400 LOC
- Import cycles (A → B → A)
- Dead exports: function/class defined but never imported elsewhere (GitNexus: Cypher query)
- Commented-out code blocks (>3 consecutive consecutive lines)
- Code in unexpected communities (GitNexus: low-cohesion communities)

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

#### GitNexus Enhancement (if available)

**Blast radius of core dependencies:**
```
gitnexus_impact(target="<core-utility-function>", direction="upstream", repo="<repo-name>")
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

#### GitNexus Enhancement (if available)

**Trace error propagation through call chains:**
```
gitnexus_context(name="<key-error-handler-or-middleware>", repo="<repo-name>", kind="Function")
```
Use `gitnexus_context` on error handlers, middleware, and fallback functions to trace how errors propagate. If errors are caught and swallowed at multiple levels, that's a finding.

**Impact of changing error types:**
```
gitnexus_impact(target="<error-class-or-interface>", direction="upstream", repo="<repo-name>")
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

For large codebases (>50k LOC), delegate heavy dimensions to parallel sub-agents. Sub-agents CANNOT use GitNexus — they use standard tools only:

```
task(category="unspecified-low", run_in_background=true, load_skills=[], prompt="[CONTEXT] Tech debt audit. [GOAL] Audit dimensions 1 (Architecture) and 2 (Consistency). [REQUEST] Run ast_grep and grep searches for dimensions 1-2 from the tech-debt-audit skill. Report every finding with file:line:col. Tag severity: Critical/High/Medium/Low.")
task(category="unspecified-low", run_in_background=true, load_skills=[], prompt="[CONTEXT] Tech debt audit. [GOAL] Audit dimensions 3 (Type debt) and 7 (Error handling). [REQUEST] Run searches for dimensions 3 and 7 from the tech-debt-audit skill. Report every finding with file:line:col. Tag severity.")
```

Spawn 2-3 sub-agents for the heaviest dimensions, collect results in parallel, then synthesize. The main agent handles GitNexus queries itself while sub-agents run the standard tool passes.

## Phase 3: Synthesize & Deliver

1. Collect all findings from direct tool calls, GitNexus queries (if available), and sub-agent results
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
