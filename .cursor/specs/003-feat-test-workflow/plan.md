# Implementation Plan: Test Workflow and Command

**Branch**: `003-test-workflow` | **Date**: 2025-12-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `.cursor/specs/003-feat-test-workflow/spec.md`

## Summary

Validate the `/specify` command workflow by testing the complete execution path from command invocation through spec creation. This includes testing the shell scripts (`setup-specify.sh`, `common.sh`), governance agent integration (Context Steward, Product Strategist, Historian), and artifact creation (branch, spec folder, spec.md, changelog).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| Simplicity-First | ✅ PASS | Testing existing workflow, no new abstractions |
| Test-First Development | ✅ PASS | Testing is the core purpose of this feature |
| Documentation Discipline | ✅ PASS | All artifacts documented in spec and plan |
| Governance Enforcement | ✅ PASS | Context Steward, Historian patterns followed |

## Research

<!-- Phase 0: Research findings - No external library research needed -->

**No external library research required.** This feature tests internal workflow components:

1. **Shell Script Testing**: Using bash/zsh built-in commands and conventions
2. **Git Integration**: Standard git CLI operations (`git checkout -b`, `git rev-parse`)
3. **File System Operations**: Standard POSIX file operations (`mkdir -p`, `cp`, `touch`)
4. **Mode Integration**: Internal Cursor custom agents (no external dependencies)

**Internal Component Analysis**:
- `common.sh` (210 lines): Path detection, branch validation, feature path functions
- `setup-specify.sh` (expected): Branch creation, spec folder setup, template copying
- Custom agents: Context Steward, Product Strategist, Historian

## Data Model

<!-- Phase 1: Data agentl design -->

### Feature Paths Structure

```
REPO_ROOT           = /Users/eru/Documents/GitHub/poly-fun
CURRENT_BRANCH      = 003-test-workflow
HAS_GIT             = true
FEATURE_DIR         = .cursor/specs/003-feat-test-workflow
FEATURE_SPEC        = .cursor/specs/003-feat-test-workflow/spec.md
IMPL_PLAN           = .cursor/specs/003-feat-test-workflow/plan.md
TASKS               = .cursor/specs/003-feat-test-workflow/tasks.md
STATUS              = .cursor/specs/003-feat-test-workflow/status.md
CHANGELOG_DIR       = .cursor/specs/003-feat-test-workflow/changelog
```

### Script Output Contract (JSON Mode)

```json
{
  "BRANCH_NAME": "string - git branch name created (e.g., '003-test-feature')",
  "SPEC_DIR": "string - absolute path to spec folder",
  "SPEC_FILE": "string - absolute path to spec.md"
}
```

## Contracts

<!-- Phase 1: API contracts and interfaces -->

### Shell Script Contracts

**`setup-specify.sh` Expected Interface**:
```bash
# Input
setup-specify.sh --json "feature description"
setup-specify.sh --json --linear --issue-id "POLY-42" "feature description"

# Output (JSON agent)
{"BRANCH_NAME":"003-test-feature","SPEC_DIR":"/path/to/spec","SPEC_FILE":"/path/to/spec.md"}

# Exit codes
0 = Success
1 = Error (invalid branch, missing template, git error)
```

**`common.sh` Function Contracts**:

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `get_repo_root()` | none | path string | Find repository root |
| `get_current_branch()` | none | branch name | Get current git branch |
| `has_git()` | none | exit code | Check if git repo exists |
| `check_feature_branch()` | branch, has_git | exit code | Validate branch naming |
| `get_feature_dir()` | repo_root, branch | path string | Compute feature directory |
| `find_feature_dir_by_prefix()` | repo_root, branch | path string | Find existing spec folder |
| `get_feature_paths()` | none | env vars (stdout) | Export all path variables |

### Mode Integration Contracts

**Context Steward → Calling Mode**:
```json
{
  "feature_id": "003-feat-test-workflow",
  "full_path": ".cursor/specs/003-feat-test-workflow/",
  "is_new": false,
  "rationale": "Existing feature folder validated",
  "validated": true
}
```

**Historian Entry Contract**:
- File: `changelog/YYYY-MM-DD__agent-name__scope.md`
- Sections: Date, Mode, Scope, Summary, Files Touched, Key Decisions, Next Steps
- Length: 5-10 lines (not verbose)

## Technical Context

**Language/Version**: Bash/Zsh (POSIX-compatible)  
**Primary Dependencies**: Git, coreutils (mkdir, cp, touch)  
**Storage**: File system (POSIX)  
**Testing**: Manual execution, expected output validation  
**Target Platform**: macOS (darwin 24.6.0), Linux  
**Project Type**: Single (workflow testing)  
**Performance Goals**: Commands complete in <5 seconds  
**Constraints**: Must work without git (graceful degradation)  
**Scale/Scope**: Test single workflow execution path

## Project Structure

### Documentation (this feature)

```text
.cursor/specs/003-feat-test-workflow/
├── spec.md              # Feature specification ✅
├── plan.md              # This file ✅
├── tasks.md             # Task breakdown (next phase)
├── status.md            # Feature status tracking
└── changelog/           # Feature changelog entries
    ├── index.md
    └── 2025-01-27__product-strategist__test-workflow-spec.md ✅
```

### Source Code (repository root)

```text
.cursor/scripts/bash/
├── common.sh            # Shared functions (exists, 210 lines)
├── setup-specify.sh     # Specify command script (to verify)
├── setup-plan.sh        # Plan command script (exists, 118 lines)
└── setup-tasks.sh       # Tasks command script (to verify)

.cursor/commands/
├── specify.md           # Specify command definition (to verify)
├── plan.md              # Plan command definition (exists)
└── implement.md         # Implement command definition (exists)

.cursor/agents/
├── context-steward.md   # Path governance agent (exists)
├── product-strategist.md # Spec creation agent (to verify)
├── strategic-architect.md # Plan creation agent (exists)
└── historian.md         # Changelog agent (exists)
```

**Structure Decision**: Single project layout - testing internal workflow scripts and agents.

## Complexity Tracking

> No constitution violations. This is a minimal testing feature with no new abstractions.

| Check | Result | Notes |
|-------|--------|-------|
| New dependencies | 0 | Using existing shell scripts |
| New abstractions | 0 | Testing existing agents |
| New patterns | 0 | Following established workflow |

## Implementation Phases

### Phase 1: Verify Existing Components
1. Confirm `setup-specify.sh` exists and matches expected interface
2. Confirm `specify.md` command exists and invokes correct script
3. Confirm `product-strategist.md` agent exists

### Phase 2: Manual Execution Test
1. Execute `/specify "test feature"` manually
2. Verify branch creation (or graceful skip if already on branch)
3. Verify spec folder creation with canonical naming
4. Verify spec.md created from template
5. Verify changelog entry created

### Phase 3: Edge Case Validation
1. Test without git repository (should skip branch creation)
2. Test with existing spec folder (should reuse or conflict gracefully)
3. Test with long feature name (should truncate and warn)
4. Test with missing template (should create empty spec.md)

## Next Steps

1. **Create tasks** (`/tasks`): Break down into executable tasks
2. **Implement** (`/implement`): Execute test phases
3. **Validate**: Confirm all acceptance criteria from spec.md

## References

- Spec: [spec.md](./spec.md)
- Template: `.cursor/templates/plan-template.md`
- Constitution: `.cursor/memory/constitution.md`
- Context Steward: `.cursor/agents/context-steward.md`
- Strategic Architect: `.cursor/agents/strategic-architect.md`
- Historian: `.cursor/agents/historian.md`
