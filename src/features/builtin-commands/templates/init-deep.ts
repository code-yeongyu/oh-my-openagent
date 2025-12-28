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

Launch **ALL tasks simultaneously**:

<parallel-tasks>

### Structural Analysis (bash - run in parallel)
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

### Context Gathering (Explore agents - background_task in parallel)

\`\`\`
background_task(agent="explore", prompt="Project structure: PREDICT standard {lang} patterns → FIND package.json/pyproject.toml/go.mod → REPORT deviations only")

background_task(agent="explore", prompt="Entry points: PREDICT typical (main.py, index.ts) → FIND actual → REPORT non-standard organization")

background_task(agent="explore", prompt="Conventions: FIND .cursor/rules, .cursorrules, eslintrc, pyproject.toml → REPORT project-specific rules DIFFERENT from defaults")

background_task(agent="explore", prompt="Anti-patterns: FIND comments with 'DO NOT', 'NEVER', 'ALWAYS', 'LEGACY', 'DEPRECATED' → REPORT forbidden patterns")

background_task(agent="explore", prompt="Build/CI: FIND .github/workflows, Makefile, justfile → REPORT non-standard build/deploy patterns")

background_task(agent="explore", prompt="Test patterns: FIND pytest.ini, jest.config, test structure → REPORT unique testing conventions")
\`\`\`

</parallel-tasks>

**Collect all results. Mark "p1-analysis" as completed.**

---

## Phase 2: Complexity Scoring & Location Decision

**Mark "p2-scoring" as in_progress.**

### Scoring Matrix

| Factor | Weight | Threshold |
|--------|--------|-----------|
| File count | 3x | >20 files = high |
| Subdirectory count | 2x | >5 subdirs = high |
| Code file ratio | 2x | >70% code = high |
| Unique patterns | 1x | Has own config |
| Module boundary | 2x | Has __init__.py/index.ts |

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
- **Verbose style**: "This directory contains..." → just list it`
