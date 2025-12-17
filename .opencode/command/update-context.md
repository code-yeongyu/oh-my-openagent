---
description: Manage project context files (constitution, architecture, tech-stack, glossary) with smart auto-detection, diff/branch extraction, pattern detection, versioning, and anti-bloat guardrails.
---

# Update Context Command

You are managing the project's living documentation in `.cursor/memory/`. This command handles creation, updates, maintenance, and automated extraction of context files that serve as authoritative AI memory.

## Command Behavior

### Smart Auto-Detection (Default)

When invoked without explicit subcommand, detect intent from context:

1. **No memory files exist** → Trigger `init` flow
2. **User provides content/changes** → Trigger `update` flow with intent detection
3. **User asks to view/check** → Trigger `view` flow
4. **User mentions validation/consistency** → Trigger `validate` flow
5. **User mentions learning/extraction** → Trigger `learn` flow

### Subcommands (Power Users)

For explicit control, users can specify subcommands:

**Core Operations:**
- `/update-context init` - Initialize all memory files from templates
- `/update-context update [file]` - Update specific file (constitution, architecture, tech-stack, glossary)
- `/update-context view [file]` - Display current state of memory files
- `/update-context sync` - Validate consistency between memory files and templates
- `/update-context validate` - Check for unresolved placeholders, version integrity

**Context Extraction:**
- `/update-context learn` - Extract context from working tree diff vs main
- `/update-context learn-branch {name}` - Extract from specific branch diff
- `/update-context learn-commit {hash}` - Extract from specific commit
- `/update-context prune` - Archive stale entries (90+ days unreferenced)

## Memory Files Managed

| File | Purpose | Template | Max Lines |
|------|---------|----------|-----------|
| `constitution.md` | Core principles, governance rules | `constitution-template.md` | 200 |
| `architecture.md` | System design, components, data flow | `architecture-template.md` | 150 |
| `tech-stack.md` | Technologies, frameworks, tools | `tech-stack-template.md` | 100 |
| `glossary.md` | Domain terms, acronyms, concepts | `glossary-template.md` | 200 |
| `changelog.md` | Project history (managed by Historian) | `changelog-template.md` | N/A |
| `decisions/ADR-*.md` | Architecture Decision Records | `ADR-template.md` | 50 each |
| `skipped.log` | Audit trail of skipped extractions | N/A | N/A |

## Execution Flow

### Step 1: Determine Operation Mode

```
IF user explicitly specifies subcommand:
    USE that subcommand
ELSE IF .cursor/memory/ is empty or missing key files:
    SUGGEST init flow
ELSE IF user provides new content (principles, tech info, terms):
    TRIGGER update flow
ELSE IF user asks about current state:
    TRIGGER view flow
ELSE IF user mentions learning/extraction:
    TRIGGER learn flow
ELSE:
    ASK user what they want to do
```

### Step 2: For INIT Flow

1. Check which memory files are missing
2. For each missing file:
   a. Read corresponding template from `.cursor/templates/`
   b. Collect values for placeholder tokens from:
      - User input (if provided)
      - Existing repo context (README, docs, package files)
      - Reasonable defaults with `[NEEDS_INPUT]` markers
   c. Replace placeholders with collected values
   d. Write to `.cursor/memory/{file}.md`
3. Set initial version to `1.0.0`
4. Set `RATIFICATION_DATE` and `LAST_AMENDED_DATE` to today
5. Call Historian to create changelog entry

### Step 3: For UPDATE Flow

1. Read existing memory file(s)
2. Identify placeholder tokens of form `[ALL_CAPS_IDENTIFIER]`
3. Detect update intent:

**Intent Detection Rules**:
- Adding new principle/section → MINOR version bump
- Material edit to existing content → MINOR version bump
- Typo fix, clarification, wording → PATCH version bump
- Removing principle/section → MAJOR version bump (require confirmation)

4. Collect/derive values for changes:
   - From user input (conversation)
   - From repo context (README, docs, existing files)
   - For dates: `LAST_AMENDED_DATE` = today if changes made

5. Apply changes with proper versioning:
   ```
   CONSTITUTION_VERSION increment rules:
   - MAJOR: Backward incompatible governance/principle removals or redefinitions
   - MINOR: New principle/section added or materially expanded guidance
   - PATCH: Clarifications, wording, typo fixes, non-semantic refinements
   ```

6. **ENFORCE ANTI-BLOAT GUARDRAILS** (see Guardrails section):
   - Check file size limits before writing
   - Verify entry word limits
   - Run deduplication check
   - Apply priority scoring

7. Generate Sync Impact Report (prepend as HTML comment)

8. Propagate changes to dependent files:
   - Check `.cursor/templates/plan-template.md` Constitution Check section
   - Verify other templates reference updated principles

9. Call Historian for changelog entry
10. Call Context Steward to validate path (if creating new files)

### Step 4: For VIEW Flow

1. Read requested memory file(s)
2. Display current content with:
   - Version information
   - Last amended date
   - Summary of key sections
   - Any unresolved placeholders highlighted
   - File size vs limit (e.g., "150/200 lines")

### Step 5: For VALIDATE Flow

1. Scan all memory files for:
   - Unresolved placeholders `[ALL_CAPS]`
   - Version inconsistencies
   - Missing required sections
   - Outdated cross-references
   - File size violations (exceeds limits)

2. Report findings:
   ```
   Validation Report:
   ✅ constitution.md - v1.2.0, all placeholders resolved, 180/200 lines
   ⚠️ architecture.md - 3 unresolved placeholders, 145/150 lines
   ❌ tech-stack.md - Missing version metadata, 105/100 lines (EXCEEDS LIMIT)
   ```

3. Suggest fixes for each issue

### Step 6: For LEARN Flow (Diff Extraction)

**Purpose**: Automatically extract context from git diffs, branches, and commits.

**Triggers**:
- `/update-context learn` - Working tree vs main
- `/update-context learn-branch {branch}` - Specific branch vs main
- `/update-context learn-commit {hash}` - Specific commit

**Extraction Pipeline**:

1. **Get Diff**
2. **Parse Changes** - Extract file paths, line numbers, hunks
3. **Classify Changes** - Apply heuristics (ARCH, TECH, TERM, CONST, DECISION triggers)
4. **Apply Priority Scoring** - HIGH/MEDIUM/LOW/SKIP
5. **Deduplication Check** - 80% similarity → merge, don't add
6. **Propose Updates** - Present to user for approval
7. **Apply Approved Updates** - Write to appropriate memory file
8. **Audit Trail** - Log skipped extractions to `skipped.log`

## Governance Integration

### Context Steward Integration

Before creating new memory files:
```
Call context-steward: "Validate path for memory file: {filename}"
Steward validates: Path is in .cursor/memory/
```

### Historian Integration

After completing any update or learn operation:
```
Call historian: "Create changelog for context update"
Entry includes:
- Files modified
- Version changes
- Key decisions
- Extraction source (if learn operation)
- Next steps
```

**Trigger**: All update/learn/prune operations MUST call Historian

## Anti-Bloat Guardrails

### Hard File Size Limits

| File | Max Lines | Action if Exceeded |
|------|-----------|-------------------|
| `constitution.md` | 200 | Prune oldest principles or split |
| `architecture.md` | 150 | Consolidate components or archive old |
| `tech-stack.md` | 100 | Remove deprecated tech or consolidate |
| `glossary.md` | 200 | Archive least-used terms |
| `decisions/ADR-*.md` | 50 each | Split into multiple ADRs |

### Entry Word Limits

| Entry Type | Max Words | Rationale Limit |
|------------|-----------|-----------------|
| Principle | 50 | 30 |
| Component | 20 | N/A |
| Tech entry | 10 | N/A |
| Term definition | 15 | N/A |
| Decision (ADR) | 100 total | Included |

## Output Format

After completing any operation, provide:

1. **Summary**: What was done
2. **Files Modified**: List with before/after versions and line counts
3. **Extraction Results** (if learn operation): Findings, updates, skipped
4. **Sync Impact Report**: Changes and affected templates
5. **Next Steps**: Any manual follow-up needed
6. **Commit Message Suggestion**

## References

- Constitution: `.cursor/memory/constitution.md`
- Architecture: `.cursor/memory/architecture.md`
- Tech Stack: `.cursor/memory/tech-stack.md`
- Glossary: `.cursor/memory/glossary.md`
- Decisions: `.cursor/memory/decisions/`
- Skipped Log: `.cursor/memory/skipped.log`
- Templates: `.cursor/templates/*-template.md`
- Context Steward: `.opencode/agent/context-steward.md`
- Historian: `.opencode/agent/historian.md`
- Pattern Detection: `.opencode/agent/meta-improvement-analyst.md`
