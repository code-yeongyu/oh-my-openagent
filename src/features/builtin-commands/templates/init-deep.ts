export const INIT_DEEP_TEMPLATE = `# Initialize Deep Knowledge Base

Generate comprehensive AGENTS.md files across project hierarchy. Combines root-level project knowledge (gen-knowledge) with complexity-based subdirectory documentation (gen-knowledge-deep).

## Usage

\`\`\`
/init-deep                      # Analyze and generate hierarchical AGENTS.md
/init-deep --create-new         # Force create from scratch (ignore existing)
/init-deep --max-depth=2        # Limit to N directory levels (default: 3)
\`\`\`

---

## Core Principles

- **Telegraphic Style**: Sacrifice grammar for concision ("Project uses React" → "React 18")
- **Predict-then-Compare**: Predict standard → find actual → document ONLY deviations
- **Hierarchy Aware**: Parent covers general, children cover specific
- **No Redundancy**: Child AGENTS.md NEVER repeats parent content
- **LSP-First**: Use LSP tools for accurate code intelligence when available (semantic > text search)

---

## Process

<critical>
**MANDATORY: TodoWrite for ALL phases. Mark in_progress → completed in real-time.**
</critical>

### Phase 0: Initialize

\`\`\`
TodoWrite([
  { id: "p1-analysis", content: "Parallel project structure & complexity analysis", status: "pending", priority: "high" },
  { id: "p2-scoring", content: "Score directories, determine AGENTS.md locations", status: "pending", priority: "high" },
  { id: "p3-root", content: "Generate root AGENTS.md with Predict-then-Compare", status: "pending", priority: "high" },
  { id: "p4-subdirs", content: "Generate subdirectory AGENTS.md files in parallel", status: "pending", priority: "high" },
  { id: "p5-review", content: "Review, deduplicate, validate all files", status: "pending", priority: "medium" }
])
\`\`\`

---

## Phase 1: Parallel Project Analysis

**Mark "p1-analysis" as in_progress.**

<critical>
**EXECUTION PATTERN**: Fire background agents FIRST (non-blocking), then main session builds codemap understanding using LSP tools in parallel. This maximizes throughput—agents discover while you analyze.
</critical>

---

### Step 1: Fire Background Explore Agents (IMMEDIATELY)

Fire ALL background tasks at once. They run asynchronously—don't wait for results yet.

\`\`\`
// Fire immediately - these run in parallel, non-blocking
background_task(agent="explore", prompt="Project structure: PREDICT standard {lang} patterns → FIND package.json/pyproject.toml/go.mod → REPORT deviations only")

background_task(agent="explore", prompt="Entry points: PREDICT typical (main.py, index.ts) → FIND actual → REPORT non-standard organization")

background_task(agent="explore", prompt="Conventions: FIND .cursor/rules, .cursorrules, eslintrc, pyproject.toml → REPORT project-specific rules DIFFERENT from defaults")

background_task(agent="explore", prompt="Anti-patterns: FIND comments with 'DO NOT', 'NEVER', 'ALWAYS', 'LEGACY', 'DEPRECATED' → REPORT forbidden patterns")

background_task(agent="explore", prompt="Build/CI: FIND .github/workflows, Makefile, justfile → REPORT non-standard build/deploy patterns")

background_task(agent="explore", prompt="Test patterns: FIND pytest.ini, jest.config, test structure → REPORT unique testing conventions")
\`\`\`

---

### Step 2: Main Session Codemap Understanding (while background runs)

While background agents discover patterns, main session builds codemap understanding using direct tools.

<parallel-tools>

#### Structural Analysis (bash)
\`\`\`bash
# Task A: Directory depth analysis
find . -type d -not -path '*/\\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/__pycache__/*' -not -path '*/dist/*' -not -path '*/build/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Task B: File count per directory  
find . -type f -not -path '*/\\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/__pycache__/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Task C: Code concentration
find . -type f \\( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \\) -not -path '*/node_modules/*' -not -path '*/venv/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Task D: Existing knowledge files
find . -type f \\( -name "AGENTS.md" -o -name "CLAUDE.md" \\) -not -path '*/node_modules/*' 2>/dev/null
\`\`\`

#### LSP Codemap Analysis (main session - semantic understanding)

LSP provides semantic understanding beyond text search. Build the codemap while background agents run.

\`\`\`
# Check LSP availability first
lsp_servers()  # Verify language server is available

# Analyze entry point files (run in parallel)
lsp_document_symbols(filePath="src/index.ts")      # Main entry
lsp_document_symbols(filePath="src/main.py")       # Python entry
lsp_document_symbols(filePath="cmd/main.go")       # Go entry

# Discover key symbols across workspace (run in parallel)
lsp_workspace_symbols(filePath=".", query="class")      # All classes
lsp_workspace_symbols(filePath=".", query="interface")  # All interfaces
lsp_workspace_symbols(filePath=".", query="function")   # Top-level functions
lsp_workspace_symbols(filePath=".", query="type")       # Type definitions

# Analyze symbol centrality (for top 5-10 key symbols)
# High reference count = central/important concept
lsp_find_references(filePath="src/index.ts", line=X, character=Y)  # Main export
\`\`\`

</parallel-tools>

#### Codemap Output Format

\`\`\`
CODE_INTELLIGENCE = {
  entry_points: [
    { file: "src/index.ts", exports: ["Plugin", "createHook"], symbol_count: 12 }
  ],
  key_symbols: [
    { name: "Plugin", type: "class", file: "src/index.ts", refs: 45, role: "Central orchestrator" },
    { name: "createHook", type: "function", file: "src/utils.ts", refs: 23, role: "Hook factory" }
  ],
  module_boundaries: [
    { dir: "src/hooks", exports: 21, imports_from: ["shared/"] },
    { dir: "src/tools", exports: 15, imports_from: ["shared/", "hooks/"] }
  ]
}
\`\`\`

<critical>
**LSP Fallback**: If LSP unavailable (no server installed), skip LSP section and rely on explore agents + AST-grep patterns.
</critical>

---

### Step 3: Collect Background Results

After main session analysis complete, collect background agent results:

\`\`\`
// Collect all background_task results
// background_output(task_id="...") for each fired task
\`\`\`

**Merge bash + LSP + background agent findings. Mark "p1-analysis" as completed.**

---

## Phase 2: Complexity Scoring & Location Decision

**Mark "p2-scoring" as in_progress.**

### Scoring Matrix

| Factor | Weight | Threshold | Source |
|--------|--------|-----------|--------|
| File count | 3x | >20 files = high | bash |
| Subdirectory count | 2x | >5 subdirs = high | bash |
| Code file ratio | 2x | >70% code = high | bash |
| Unique patterns | 1x | Has own config | explore |
| Module boundary | 2x | Has __init__.py/index.ts | bash |
| **Symbol density** | 2x | >30 symbols = high | LSP |
| **Export count** | 2x | >10 exports = high | LSP |
| **Reference centrality** | 3x | Symbols with >20 refs | LSP |

<lsp-scoring>
**LSP-Enhanced Scoring** (if available):

\`\`\`
For each directory in candidates:
  symbols = lsp_document_symbols(dir/index.ts or dir/__init__.py)
  
  symbol_score = len(symbols) > 30 ? 6 : len(symbols) > 15 ? 3 : 0
  export_score = count(exported symbols) > 10 ? 4 : 0
  
  # Check if this module is central (many things depend on it)
  for each exported symbol:
    refs = lsp_find_references(symbol)
    if refs > 20: centrality_score += 3
  
  total_score += symbol_score + export_score + centrality_score
\`\`\`
</lsp-scoring>

### Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create AGENTS.md |
| **High (>15)** | Create dedicated AGENTS.md |
| **Medium (8-15)** | Create if distinct domain |
| **Low (<8)** | Skip, parent sufficient |

### Output Format

\`\`\`
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "src/api", score: 18, reason: "high complexity, 45 files" },
  { path: "src/hooks", score: 12, reason: "distinct domain, unique patterns" },
]
\`\`\`

**Mark "p2-scoring" as completed.**

---

## Phase 3: Generate Root AGENTS.md

**Mark "p3-root" as in_progress.**

Root AGENTS.md gets **full treatment** with Predict-then-Compare synthesis.

### Required Sections

\`\`\`markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}
**Branch:** {BRANCH}

## OVERVIEW

{1-2 sentences: what project does, core tech stack}

## STRUCTURE

\\\`\\\`\\\`
{project-root}/
├── {dir}/      # {non-obvious purpose only}
└── {entry}     # entry point
\\\`\\\`\\\`

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add feature X | \\\`src/x/\\\` | {pattern hint} |

## CODE MAP

{Generated from LSP analysis - shows key symbols and their relationships}

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| {MainClass} | Class | \\\`src/index.ts\\\` | {N} | {Central orchestrator} |
| {createX} | Function | \\\`src/utils.ts\\\` | {N} | {Factory pattern} |
| {Config} | Interface | \\\`src/types.ts\\\` | {N} | {Configuration contract} |

### Module Dependencies

\\\`\\\`\\\`
{entry} ──imports──> {core/}
   │                    │
   └──imports──> {utils/} <──imports── {features/}
\\\`\\\`\\\`

<code-map-note>
**Skip CODE MAP if**: LSP unavailable OR project too small (<10 files) OR no clear module boundaries.
</code-map-note>

## CONVENTIONS

{ONLY deviations from standard - skip generic advice}

- **{rule}**: {specific detail}

## ANTI-PATTERNS (THIS PROJECT)

{Things explicitly forbidden HERE}

- **{pattern}**: {why} → {alternative}

## UNIQUE STYLES

{Project-specific coding styles}

- **{style}**: {how different}

## COMMANDS

\\\`\\\`\\\`bash
{dev-command}
{test-command}
{build-command}
\\\`\\\`\\\`

## NOTES

{Gotchas, non-obvious info}
\`\`\`

### Quality Gates

- [ ] Size: 50-150 lines
- [ ] No generic advice ("write clean code")
- [ ] No obvious info ("tests/ has tests")
- [ ] Every item is project-specific

**Mark "p3-root" as completed.**

---

## Phase 4: Generate Subdirectory AGENTS.md

**Mark "p4-subdirs" as in_progress.**

For each location in AGENTS_LOCATIONS (except root), launch **parallel document-writer agents**:

\`\`\`typescript
for (const loc of AGENTS_LOCATIONS.filter(l => l.path !== ".")) {
  background_task({
    agent: "document-writer",
    prompt: \\\`
      Generate AGENTS.md for: \${loc.path}
      
      CONTEXT:
      - Complexity reason: \${loc.reason}
      - Parent AGENTS.md: ./AGENTS.md (already covers project overview)
      
      CRITICAL RULES:
      1. Focus ONLY on this directory's specific context
      2. NEVER repeat parent AGENTS.md content
      3. Shorter is better - 30-80 lines max
      4. Telegraphic style - sacrifice grammar
      
      REQUIRED SECTIONS:
      - OVERVIEW (1 line: what this directory does)
      - STRUCTURE (only if >5 subdirs)
      - WHERE TO LOOK (directory-specific tasks)
      - CONVENTIONS (only if DIFFERENT from root)
      - ANTI-PATTERNS (directory-specific only)
      
      OUTPUT: Write to \${loc.path}/AGENTS.md
    \\\`
  })
}
\`\`\`

**Wait for all agents. Mark "p4-subdirs" as completed.**

---

## Phase 5: Review & Deduplicate

**Mark "p5-review" as in_progress.**

### Validation Checklist

For EACH generated AGENTS.md:

| Check | Action if Fail |
|-------|----------------|
| Contains generic advice | REMOVE the line |
| Repeats parent content | REMOVE the line |
| Missing required section | ADD it |
| Over 150 lines (root) / 80 lines (subdir) | TRIM |
| Verbose explanations | REWRITE telegraphic |

### Cross-Reference Validation

\`\`\`
For each child AGENTS.md:
  For each line in child:
    If similar line exists in parent:
      REMOVE from child (parent already covers)
\`\`\`

**Mark "p5-review" as completed.**

---

## Final Report

\`\`\`
=== init-deep Complete ===

Files Generated:
  ✓ ./AGENTS.md (root, {N} lines)
  ✓ ./src/hooks/AGENTS.md ({N} lines)
  ✓ ./src/tools/AGENTS.md ({N} lines)

Directories Analyzed: {N}
AGENTS.md Created: {N}
Total Lines: {N}

Hierarchy:
  ./AGENTS.md
  ├── src/hooks/AGENTS.md
  └── src/tools/AGENTS.md
\`\`\`

---

## Anti-Patterns for THIS Command

- **Over-documenting**: Not every directory needs AGENTS.md
- **Redundancy**: Child must NOT repeat parent
- **Generic content**: Remove anything that applies to ALL projects
- **Sequential execution**: MUST use parallel agents
- **Deep nesting**: Rarely need AGENTS.md at depth 4+
- **Verbose style**: "This directory contains..." → just list it
- **Ignoring LSP**: If LSP available, USE IT - semantic analysis > text grep
- **LSP without fallback**: Always have explore agent backup if LSP unavailable
- **Over-referencing**: Don't trace refs for EVERY symbol - focus on exports only`
