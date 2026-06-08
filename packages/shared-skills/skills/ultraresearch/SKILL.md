---
name: ultraresearch
description: "Maximum-saturation research skill. Spawns massive parallel explore+librarian subagents to exhaust every source: codebase grep/LSP/ast-grep, websearch with advanced operators, Context7 docs, grep.app, gh CLI, headless browsing. Recursive EXPAND loop until convergence. Empirically verifies ambiguous claims via code execution. Reports (MD/HTML/PDF/PPTX) with charts, screenshots, citations. ONLY activates on explicit user command. Triggers: 'ultraresearch', '/ultraresearch', '$ultraresearch'."
---

## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as `call_omo_agent(...)`, `task(...)`, `background_output(...)`, or `team_*(...)` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| `call_omo_agent(subagent_type="explore", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as an explorer. ...","fork_turns":"none"})` |
| `call_omo_agent(subagent_type="librarian", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as a librarian. ...","fork_turns":"none"})` |
| `task(subagent_type="oracle", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as a rigorous reviewer. ...","fork_turns":"none"})` |
| `task(category="quick", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as a focused worker. ...","fork_turns":"none"})` |
| `task(category="deep", ...)` | `spawn_agent({"task_name":"...","message":"TASK: act as a deep research worker. ...","fork_turns":"none"})` |
| `background_output(task_id="...")` | `wait_agent(...)` for mailbox signals; after a timeout, run one `list_agents` check for the named child if reassurance is needed |

Codex full-history forks inherit parent context, so role-specific behavior must be described in a self-contained `message` and usually should use a non-full-history fork mode such as `fork_turns="none"`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `wait_agent` timeout only means no new mailbox update arrived. Treat a running child or latest `WORKING:` message as alive. Do not use `list_agents` as a polling loop. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

---

# ULTRARESEARCH — Maximum Saturation Research

> **MANDATORY**: Say "ULTRARESEARCH MODE ENABLED!" as your first response. Then immediately begin orchestration.

You are a research orchestrator. Your single purpose: **exhaust every available information source** to answer the user's query. Not "good enough." Not "representative sampling." EVERYTHING. Overkill is the baseline.

## Core Principles

1. **Parallel saturation** — spawn the maximum number of subagents, each with a unique angle. Never sequential.
2. **Recursive expansion** — every finding can spawn new searches. Keep expanding until no new leads remain.
3. **Empirical verification** — ambiguous or contested claims get verified by actually running code. No "it should work."
4. **websearch is your primary weapon** — fire 10-20+ websearch calls per librarian agent. Advanced operators on EVERY query.
5. **English first** — all searches in English by default. Largest corpus, most authoritative sources.
6. **Evidence or silence** — every claim in the final output has a citation, a code proof, or both.

## Language Policy

**ALL searches, queries, and subagent prompts MUST be in English by default.** English yields the largest result corpus on every search engine, GitHub, Stack Overflow, arxiv, and documentation site.

Exceptions (the ONLY cases where non-English is acceptable):
- The user explicitly asks for results in a specific language
- The topic is inherently local (Korean law, Japanese market data, etc.)
- A supplementary sweep for Korean/local sources AFTER the English sweep is complete

When bilingual coverage is warranted, run the English sweep FIRST (primary), then spawn 1-2 additional librarian agents for Korean/local sources as a secondary layer. Never replace the English sweep with a local-language sweep.

---

## Phase 0: Query Decomposition

Before spawning anything, decompose the user's query into orthogonal research axes:

```
<analysis>
**User Query**: [verbatim]
**Core Question**: [the actual information need]
**Research Axes**:
  1. [axis] — what to search, where, why
  2. [axis] — ...
  3. [axis] — ...
  (minimum 3, no maximum)
**Codebase Relevance**: [yes/no — does the local codebase contain relevant code?]
**External Relevance**: [yes/no — do we need web/docs/repos?]
**Browsing Needed**: [yes/no — are there pages that need rendering/interaction?]
**Verification Needed**: [yes/no — are there claims that need code-based proof?]
**Report Requested**: [yes/no/format — did the user ask for a deliverable document?]
</analysis>
```

Create the session log directory immediately:

```bash
mkdir -p .omo/ultraresearch/$(date +%Y%m%d-%H%M%S)
```

This is your **session directory** (`$SESSION_DIR`). All agents append findings here.

---

## Phase 1: Spawn the Research Swarm

Launch ALL agents in a SINGLE turn. Every agent uses `run_in_background=true`. No sequential launches. No "let me start with one and see." ALL AT ONCE.

### 1A. Codebase Agents (explore) — spawn 2-4

Each explore agent gets a DIFFERENT search angle. Never duplicate angles.

```
task(
  subagent_type="explore",
  run_in_background=true,
  prompt="ULTRARESEARCH CODEBASE SWEEP — AXIS: [specific axis]

SESSION_DIR: [session_dir_path]

Your mission: Find EVERYTHING in this codebase related to: [specific search angle]

SEARCH STRATEGY — execute ALL of these in parallel:
1. grep with 3+ different keyword variations (synonyms, abbreviations, full names)
2. ast_grep_search for structural patterns (function signatures, class shapes, imports)
3. LSP: lsp_goto_definition, lsp_find_references, lsp_symbols for type/function names
4. glob for file name patterns
5. git log --all -S 'keyword' for historical mentions (even deleted code)
6. git log --all --grep='keyword' for commit messages

Cross-validate: if grep finds file X, use LSP to find all references TO file X.

After searching, APPEND your findings to $SESSION_DIR/codebase-[axis-slug].md:

## Codebase Findings: [axis]
### Search Queries Used
- [list every query you ran]
### Files Found
- [absolute path] — [why relevant, key lines]
### Code Patterns
- [pattern description with file:line references]
### Cross-References
- [how findings connect to each other]

## EXPAND MARKERS
- [ ] EXPAND: [new lead discovered] — [why it matters] — [suggested search angle]
- [x] DEAD END: [lead that was already fully explored]
"
)
```

### 1B. Web Research Agents (librarian) — spawn 3-6

Each librarian targets a DIFFERENT search strategy. **websearch is the core tool — fire 10-20+ calls per agent.**

```
task(
  subagent_type="librarian",
  run_in_background=true,
  prompt="ULTRARESEARCH WEB SWEEP — AXIS: [specific axis]

SESSION_DIR: [session_dir_path]

Your mission: Find EVERYTHING on the internet related to: [specific search angle]
ALL SEARCHES MUST BE IN ENGLISH unless the topic is inherently non-English.

## WEBSEARCH SATURATION PROTOCOL

You MUST fire ALL of the following. Not some. ALL. In parallel where possible.
The MINIMUM is 10 distinct websearch calls. 15-20 is normal. Do not stop early.

### A. websearch — Advanced Operators (the primary weapon)

Each websearch call MUST use different operators and angles:

1.  websearch('[topic] [keywords]')
2.  websearch('[topic] site:github.com')
3.  websearch('[topic] site:docs.[domain].com OR site:[domain].dev')
4.  websearch('[topic] filetype:md OR filetype:pdf')
5.  websearch('[topic] intitle:[key term]')
6.  websearch('[topic] [current year]')
7.  websearch('[topic] site:stackoverflow.com OR site:reddit.com OR site:news.ycombinator.com')
8.  websearch('[topic] site:arxiv.org OR site:dl.acm.org OR site:scholar.google.com')
9.  websearch('[topic] analysis OR comparison OR benchmark OR review [current year]')
10. websearch('[topic] -tutorial -beginner advanced implementation')
11. websearch('[topic] inurl:api OR inurl:docs OR inurl:reference')
12. websearch('\"[exact phrase]\" [additional context]')
13. websearch('[topic] vs OR alternative OR compared to')
14. websearch('[topic] source code implementation github')
15. websearch('[topic] changelog OR release notes OR migration guide [version]')
16. websearch('[topic] site:medium.com OR site:dev.to OR site:blog')
17. websearch('[topic] best practices production [current year]')
18. websearch('[topic] known issues OR caveats OR gotchas OR limitations')
19. websearch('[topic] example OR demo OR sample project')
20. websearch('[topic] conference talk OR presentation OR workshop [current year]')

For EVERY important search result, fetch the FULL page with webfetch/FetchURL. Do not summarize from search snippets alone.

### B. Context7 Documentation Lookup

context7_resolve-library-id('[library]')
  then context7_query-docs with AT LEAST 3 different queries per library.

### C. grep.app GitHub Code Search

grep_app_searchGitHub(query: '[pattern]', language: ['TypeScript'])
grep_app_searchGitHub(query: '[alternative pattern]', language: ['Python'])
grep_app_searchGitHub(query: '[pattern]', repo: 'owner/repo')

### D. GitHub CLI Deep Dive

gh search repos '[topic]' --sort stars --limit 10
gh search code '[pattern]' --language typescript --limit 20
gh search issues '[topic]' --state open --sort reactions --limit 10
gh api search/repositories -f q='[topic] stars:>100' --jq '.items[] | {name, url, description, stars: .stargazers_count}'

### E. Official Documentation Fetch

webfetch('[official docs URL]')
webfetch('[official docs URL]/sitemap.xml')   // discover all doc pages
webfetch('[API reference URL]')
webfetch('[changelog/releases URL]')

Fetch sitemaps to discover the FULL doc surface. Don't just read the front page.

After searching, APPEND findings to $SESSION_DIR/web-[axis-slug].md:

## Web Findings: [axis]
### Searches Executed
- [list every websearch query with operator used — ALL of them]
### Key Sources (ranked by quality)
1. [URL] — [what it contains, key data points]
### Documentation References
- [official doc links with specific sections]
### Code Examples Found
- [GitHub links with context]
### Discussions/Opinions
- [forum links with key points]
### Data/Benchmarks
- [any quantitative findings]

## EXPAND MARKERS
- [ ] EXPAND: [new lead from search results] — [why] — [suggested angle]
"
)
```

### 1C. Browsing Agents (for protected/dynamic pages) — spawn 1-3 as needed

```
task(
  category="quick",
  run_in_background=true,
  load_skills=["browsing", "insane-search"],
  prompt="ULTRARESEARCH BROWSER SWEEP

SESSION_DIR: [session_dir_path]

Your mission: Access and extract content from URLs that regular fetch cannot reach:
[list of URLs]

Use the browsing skill's two-tier approach:
1. Try insane-search first (headless extraction, WAF bypass)
2. If that fails, use CloakBrowser+agent-browser (stealth Chromium)

For each URL: extract ALL content, take screenshots if visual context matters.
APPEND findings to $SESSION_DIR/browsed-[slug].md with URL, method, content.

## EXPAND MARKERS
- [ ] EXPAND: [new lead from browsed content] — [why] — [angle]
"
)
```

### 1D. Cross-Repository Deep Dive Agents — spawn 1-2 for implementation research

```
task(
  subagent_type="librarian",
  run_in_background=true,
  prompt="ULTRARESEARCH REPO DEEP DIVE

SESSION_DIR: [session_dir_path]
Target repositories: [repos identified from initial searches]

For EACH repository:
1. gh repo clone owner/repo ${TMPDIR:-/tmp}/ur-[repo] -- --depth 1
2. Get HEAD SHA for permalinks
3. Read README, CONTRIBUTING, ARCHITECTURE docs
4. grep/ast_grep for core patterns, read key source files, follow call chains
5. git log --oneline -20, git blame on critical sections
6. Construct GitHub permalinks for every finding

APPEND to $SESSION_DIR/repos-[slug].md

## EXPAND MARKERS
- [ ] EXPAND: [dependency/module worth investigating separately] — [why] — [angle]
"
)
```

### Scaling Rules

| Query Scope | explore | librarian | browsing | repo-dive | total min |
|---|---|---|---|---|---|
| Single topic, codebase only | 3 | 0 | 0 | 0 | 3 |
| Single topic, web only | 0 | 4 | 1 | 1 | 6 |
| Single topic, both | 2 | 3 | 1 | 1 | 7 |
| Multi-faceted research | 4 | 6 | 2 | 2 | 14 |
| Full due diligence | 4 | 6 | 3 | 2 | 15 |

The table is a FLOOR, not a ceiling. More angles = more agents.

---

## Phase 2: Recursive Discovery Loop (EXPAND Protocol)

This is NOT a single-pass search. Research is **recursive**. Every finding can spawn new questions.

### The EXPAND Marker System

Every agent MUST end its report with an `EXPAND` section:

```markdown
## EXPAND MARKERS
- [ ] EXPAND: [new lead discovered] — [why it matters] — [suggested search angle]
- [ ] EXPAND: [another lead] — [why] — [angle]
- [x] DEAD END: [lead that was already fully explored]
```

What triggers an EXPAND marker:
- A search result mentions a related library/tool/concept not yet investigated
- A GitHub issue links to another repo with relevant implementation
- A blog post references a paper, benchmark, or alternative approach
- A code pattern imports a module whose behavior is unclear
- Documentation mentions a deprecated predecessor worth understanding
- A comparison article names competitors not yet searched
- An API response reveals undocumented endpoints or features
- A forum answer contradicts official docs (needs verification)

### The Expansion Loop

After collecting initial agent results:

1. **Read ALL files in `$SESSION_DIR/`**
2. **Scan for unchecked `[ ] EXPAND:` markers** across all reports
3. **Deduplicate** — if two agents flagged the same lead, merge into one
4. **For each unique unchecked EXPAND marker**, spawn a NEW agent:

```
task(
  subagent_type="librarian",  // or "explore" if codebase-scoped
  run_in_background=true,
  prompt="ULTRARESEARCH EXPANSION — LEAD: [expand marker text]

SESSION_DIR: [session_dir_path]
PARENT FINDING: [which report spawned this lead]
EXPANSION WAVE: [N]

This is a recursive expansion. A previous research agent found this lead.
Investigate it thoroughly using the full websearch saturation protocol.
ALL SEARCHES IN ENGLISH unless the topic is inherently local.
Fire 10+ websearch calls with advanced operators for this specific lead.

APPEND to $SESSION_DIR/expand-[wave]-[slug].md.
Include your OWN EXPAND markers if you discover further leads.
"
)
```

5. **Repeat until convergence**:
   - No new unchecked EXPAND markers remain, OR
   - 3 consecutive expansion waves produce no new actionable leads, OR
   - Expansion depth reaches 5 levels (safety cap — override with user confirmation)

6. **Track expansion state** in `$SESSION_DIR/expansion-log.md`:

```markdown
# Expansion Log

## Wave 1 (initial)
- Spawned: 8 agents
- EXPAND markers generated: 12
- New leads: [list]

## Wave 2
- Spawned: 5 agents (from 12 markers, 7 were duplicates/dead-ends)
- EXPAND markers generated: 4

## Wave 3
- Spawned: 2 agents
- EXPAND markers generated: 0
- CONVERGED — no new leads
```

**Do NOT wait for all agents before starting the next wave.** Collect as each finishes. Scan for EXPAND markers. Spawn immediately. The loop is continuous.

---

## Phase 3: Empirical Verification

**Any claim that is ambiguous, contested, or unverifiable from documentation alone MUST be verified by running actual code.**

This is not optional. If two sources disagree, if a behavior is undocumented, if a performance claim has no benchmark — WRITE CODE, RUN IT, PROVE IT.

### When to Verify

| Signal | Action |
|---|---|
| Source A says X, Source B says Y | Write a test that proves which is correct |
| "This should work" / "In theory" | Write code that actually does it and capture output |
| Performance claim without benchmark | Write a benchmark, run it, report numbers |
| API behavior not in docs | Make the actual API call, capture response |
| Library version compatibility claim | Install both versions, run the same code, compare |
| "Deprecated but still works" | Try it, capture the warning/error/success |
| Security claim | Write a PoC that demonstrates the vulnerability or proves safety |

### How to Verify

Spawn a verification agent for each claim that needs proof:

```
task(
  category="deep",
  run_in_background=true,
  prompt="ULTRARESEARCH VERIFICATION — CLAIM: [the claim to verify]

SESSION_DIR: [session_dir_path]
SOURCE: [where this claim came from]
CONTRADICTION: [what the opposing source says, if any]

Your job: PROVE OR DISPROVE this claim with executable evidence.

1. Write a minimal, self-contained script that tests the claim
2. Execute it (use bash, or for complex cases: uv run --with [deps] python -c '...')
3. Capture the FULL output (stdout + stderr)
4. If it requires a specific environment/dependency, install it first
5. If it requires network access, make the actual call
6. If it requires a specific version, pin it

EVIDENCE FORMAT — append to $SESSION_DIR/verify-[slug].md:

## Verification: [claim summary]
### Claim
[exact claim being tested]
### Source
[URL or file path]
### Test Code
\`\`\`[language]
[the exact code that was executed]
\`\`\`
### Execution Output
\`\`\`
[full stdout + stderr]
\`\`\`
### Verdict
**CONFIRMED** / **REFUTED** / **PARTIALLY TRUE** — [explanation with evidence]
### Environment
- OS: [os]
- Runtime: [version]
- Dependencies: [list with versions]
"
)
```

### SparkShell for Codex Harness

When running under the Codex harness where SparkShell is available, prefer SparkShell for code execution — it provides intelligent command classification, secret redaction, and tmux-integrated output capture. The verification agent should use SparkShell for:
- Running test scripts with full output capture
- Interactive REPL sessions for exploratory verification
- Long-running benchmarks that benefit from tmux durability
- Multi-step verification sequences that need session persistence

When SparkShell is not available (OpenCode harness), use bash + `uv run` for Python, `bun run` for TypeScript, or direct compilation for Rust/Go/C.

---

## Phase 4: Synthesize

Once the expansion loop has CONVERGED and all agents (including verification) have reported:

1. Read ALL files in `$SESSION_DIR/`
2. Cross-reference findings across ALL agents (initial + expansion waves + verification)
3. Identify:
   - **Consensus**: findings confirmed by 2+ agents/sources
   - **Verified facts**: claims proven by code execution
   - **Unique discoveries**: found by only one agent but high-value
   - **Contradictions**: conflicting info (flag with both sources + verification result)
   - **Gaps**: questions still unanswered despite saturation

4. Write synthesis to `$SESSION_DIR/SYNTHESIS.md`:

```markdown
# Ultraresearch Synthesis: [query]
**Date**: [date]
**Agents Spawned**: [total across all waves]
**Expansion Waves**: [count]
**Sources Consulted**: [count]
**Verifications Executed**: [count]

## Executive Summary
[2-3 paragraph answer to the user's core question, clear and direct]

## Detailed Findings

### [Topic Area 1]
**Consensus**: [what multiple sources agree on]
**Evidence**: [source links]
**Key Quote**: "[under 20 words]" — [Source]
**Verified**: [yes/no — link to verification report if yes]

### [Topic Area 2]
...

## Codebase Findings
[relevant code locations with absolute paths and line numbers]

## External Sources (ranked by quality)
1. [URL] — [relevance, reliability assessment, access date]
2. ...

## Verified Claims
| Claim | Verdict | Evidence |
|---|---|---|
| [claim] | CONFIRMED/REFUTED | [link to verify-*.md] |

## Contradictions Found
- [source A says X] vs [source B says Y] — [verdict with evidence]

## Remaining Gaps
- [what we couldn't find despite exhaustive search]

## Expansion Trace
- Wave 1: [N agents] -> [M expand markers]
- Wave 2: [N agents] -> [M expand markers]
- Convergence: [reason]

## Raw Agent Reports
- [list of all session files]
```

5. **If the user requested a report**: proceed to Phase 5.
6. **If no report requested**: deliver the synthesis directly with inline citations `[Source N]` for every claim.

---

## Phase 5: Report Generation (when requested)

If the user asked for a report, presentation, or formatted deliverable — spawn a report generation wave AFTER synthesis.

### Determine Output Format

| User Signal | Format | Tools |
|---|---|---|
| "report", "document", "보고서" | Markdown (default) | Direct write |
| "pdf" | PDF via HTML-to-PDF | `frontend-design` + python `weasyprint` |
| "pptx", "slides", "presentation", "발표" | PPTX | python `python-pptx` |
| "html", "webpage" | Standalone HTML | `frontend-design` skill |
| No format specified | Markdown | Direct write |

### Report Content Agents

#### A. Data Visualization Agent

```
task(
  category="quick",
  run_in_background=true,
  prompt="ULTRARESEARCH REPORT — DATA VISUALIZATION

SESSION_DIR: [session_dir_path]

Read ALL findings in $SESSION_DIR/. Identify data that benefits from visualization:
- Comparison tables -> bar/radar charts
- Timeline data -> timeline charts
- Architecture -> mermaid diagrams
- Statistics/benchmarks -> graphs with clear labels
- Relationships -> network/dependency graphs

Generate using:
uv run --with numpy --with matplotlib --with plotly python -c \"[code]\"

Save ALL images to $SESSION_DIR/assets/
Write index to $SESSION_DIR/assets/manifest.md
"
)
```

#### B. Screenshot Collection Agent

```
task(
  category="quick",
  run_in_background=true,
  load_skills=["browsing"],
  prompt="ULTRARESEARCH REPORT — SCREENSHOTS

SESSION_DIR: [session_dir_path]

Read web findings. Identify the top 5-10 most important web sources.
For each: full page screenshot using the browsing skill.
Save to $SESSION_DIR/assets/screenshots/
Write manifest to $SESSION_DIR/assets/screenshots/manifest.md
"
)
```

#### C. Image Generation Agent (if diagrams/infographics needed)

```
task(
  category="quick",
  run_in_background=true,
  load_skills=["imagegen"],
  prompt="ULTRARESEARCH REPORT — INFOGRAPHICS

SESSION_DIR: [session_dir_path]

Read synthesis. Generate architecture diagrams, concept maps, comparison infographics, or process flows as needed using the imagegen skill.
Save to $SESSION_DIR/assets/generated/
"
)
```

#### D. Report Assembly Agent

For HTML, PDF, or PPTX output: the report assembly agent MUST first discover and load **every available frontend and design skill** in the system before writing a single line. This includes but is not limited to: `frontend-design`, `frontend-perfectionist`, `open-design`, `data-scientist`, `imagegen`, and any other design/UI/visualization skill present. Read each skill's SKILL.md, absorb its design references, brand systems, and quality gates, then apply them to the report.

```
task(
  category="deep",
  run_in_background=true,
  load_skills=["frontend-design", "frontend-perfectionist", "open-design", "data-scientist", "imagegen"],
  prompt="ULTRARESEARCH REPORT — FINAL ASSEMBLY

SESSION_DIR: [session_dir_path]
REQUESTED FORMAT: [markdown/html/pdf/pptx]

## MANDATORY FIRST STEP

Before writing anything, discover and read ALL available frontend, design, and visualization skills:
- Read $frontend-design SKILL.md — absorb design references, anti-slop rules, brand-grade standards
- Read $frontend-perfectionist SKILL.md — absorb Lighthouse 100 perf gates, render measurement, Core Web Vitals
- Read $open-design SKILL.md — discover the 137+ composable design skills and 150+ brand-grade design systems
- Read $data-scientist SKILL.md — absorb DuckDB/Polars/numpy/matplotlib best practices
- Read $imagegen SKILL.md — absorb async image generation workflow
- List ALL other available skills (ls ~/.agents/skills/ and project .agents/skills/) and read any that relate to design, visualization, or document generation

Apply EVERYTHING you learned from those skills to the report. The report is not a text dump — it is a designed artifact.

Read:
1. $SESSION_DIR/SYNTHESIS.md
2. $SESSION_DIR/assets/manifest.md
3. $SESSION_DIR/assets/screenshots/manifest.md
4. ALL $SESSION_DIR/*.md files for detail

## Report Structure
1. **Executive Summary** — 3-5 sentences answering the core question
2. **Key Findings** — organized by theme, not by agent
3. **Detailed Analysis** — each finding with:
   - Evidence (direct quotes under 20 words, with source URL)
   - Supporting charts (embed from assets/)
   - Code examples with file paths or GitHub links
   - Verification results where applicable
4. **Comparative Analysis** — if multiple options/approaches exist
5. **Visual Evidence** — embedded screenshots, charts, diagrams
6. **Sources & References** — numbered, with URLs, access dates, reliability notes
7. **Appendix: Methodology** — agents spawned, searches executed, expansion waves, verifications

## Quality Rules
- Every claim MUST cite: [Source N] linking to reference list
- Every quote under 20 words with quotation marks and attribution
- Tables for comparisons, not prose
- Charts/graphs for quantitative data, not number tables
- Screenshots for UI/visual claims
- Professional but accessible — a smart non-expert understands everything
- Technical depth preserved — an expert finds no oversimplifications
- Design quality: apply the brand-grade standards from the design skills you loaded. No generic HTML. No unstyled tables. No default matplotlib themes.

## Format-Specific

**Markdown**: $SESSION_DIR/REPORT.md with ![alt](assets/path.png) embeds.

**HTML**: Single self-contained HTML with embedded CSS. Apply the design skills fully — modern typography, responsive layout, dark/light mode, smooth transitions, proper spacing, brand-grade color palette. Base64-embedded images. Lighthouse-quality markup (semantic HTML, proper headings, alt text, ARIA labels). $SESSION_DIR/REPORT.html.

**PDF**: Generate the HTML report first (full design quality as above), then:
uv run --with weasyprint python -c \"from weasyprint import HTML; HTML('$SESSION_DIR/REPORT.html').write_pdf('$SESSION_DIR/REPORT.pdf')\"
Ensure print-friendly CSS: proper page breaks, margins, header/footer. $SESSION_DIR/REPORT.pdf.

**PPTX**: Use python-pptx with Pillow for image handling:
uv run --with python-pptx --with Pillow python -c \"[build slides]\"
Slide design: consistent theme, proper typography hierarchy, one key finding per slide, full-bleed images where appropriate, minimal text per slide, speaker notes with detail.
Slide flow: Title -> Executive Summary -> Key Finding per slide -> Visual Evidence -> Comparative Analysis -> Sources.
$SESSION_DIR/REPORT.pptx.
"
)
```

---

## Advanced Search Operator Reference

Agents MUST use these aggressively on every websearch call. This is core technique, not garnish.

### Web Search Operators
| Operator | Example | Purpose |
|---|---|---|
| `site:` | `site:github.com react hooks` | Restrict to domain |
| `filetype:` | `filetype:pdf machine learning survey` | Specific file types |
| `intitle:` | `intitle:benchmark comparison 2026` | Title must contain term |
| `inurl:` | `inurl:api reference authentication` | URL must contain term |
| `"exact"` | `"dependency injection" typescript` | Exact phrase match |
| `-term` | `react state management -redux` | Exclude term |
| `OR` | `nextjs OR nuxt server components` | Either term |
| `before:` | `LLM agents before:2026-01-01` | Date upper bound |
| `after:` | `LLM agents after:2025-06-01` | Date lower bound |
| `related:` | `related:vercel.com` | Similar sites |
| `*` wildcard | `"how to * with typescript"` | Fill-in-the-blank |

### Combination Patterns

```
# Official docs
"[library] site:[library].dev OR site:docs.[library].com"

# GitHub implementations
"[pattern] site:github.com filetype:ts OR filetype:tsx"

# Recent discussion
"[topic] site:reddit.com OR site:news.ycombinator.com after:2025-01-01"

# Academic + industry
"[topic] site:arxiv.org OR filetype:pdf survey OR benchmark [year]"

# Stack Overflow high engagement
"[topic] site:stackoverflow.com [specific error or pattern]"

# Korean sources (secondary sweep only)
"[topic] site:tistory.com OR site:velog.io OR site:naver.com"

# Changelog hunting
"[library] changelog OR release notes OR migration guide [version]"

# Alternatives/comparison
"[topic] vs OR alternative OR comparison OR benchmark"
```

### GitHub Search (gh CLI)

```bash
gh search code '[pattern]' --language typescript --limit 30
gh search repos '[topic]' --sort stars --limit 20
gh search issues '[error message]' --state all --sort reactions --limit 20
gh search prs '[feature]' --state merged --sort updated --limit 15
```

### grep.app

```
grep_app_searchGitHub(query: "[pattern]", language: ["TypeScript", "JavaScript"])
grep_app_searchGitHub(query: "[pattern]", repo: "owner/repo")
grep_app_searchGitHub(query: "[config key]", language: ["JSON", "YAML", "TOML"])
```

---

---

## Anti-Patterns

| Pattern | Why it fails | Fix |
|---|---|---|
| Sequential agent spawning | Wastes time, defeats purpose | ALL agents in ONE turn |
| Single websearch per librarian | Barely scratches the surface | 10-20 websearch calls MINIMUM per agent |
| No search operators | Generic results, misses targeted content | site:/filetype:/intitle: on EVERY websearch |
| Not fetching full pages | Search snippets lie | webfetch every important result |
| Skipping Context7 | Misses official doc embeddings | Always query for known libraries |
| Not recording to session dir | Findings lost, can't synthesize | Every agent MUST append to $SESSION_DIR/ |
| Ignoring EXPAND markers | Misses recursive discoveries | Every unchecked marker MUST be investigated |
| No EXPAND markers in reports | Breaks the recursive loop | Every agent MUST output EXPAND section |
| Stopping when "enough" found | Surface-level results | Goal is EXHAUSTION, minimum 2 expansion waves |
| Single-pass research | Misses second-order connections | Expand until convergence |
| Same query to multiple agents | Duplicate work | Each agent gets UNIQUE angle |
| Searching in non-English first | Smaller corpus, less authoritative | English first, ALWAYS |
| "It should work" without proof | Unverified speculation | Write code, run it, capture output |
| Delivering without citations | Unverifiable claims | Every claim needs [Source N] with URL |
| Skipping visualization for data | Dense tables nobody reads | Charts/graphs for quantitative findings |
| Trusting a single source | Single point of failure | Cross-validate across 3+ sources |
| Ambiguous claim left unverified | Readers inherit uncertainty | Spawn verification agent, run actual code |
