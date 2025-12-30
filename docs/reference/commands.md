---
title: "Slash Commands Reference"
description: "Complete reference for all slash commands in oh-my-opencode"
---

# Slash Commands Reference

This is a comprehensive reference for all 42 slash commands available in oh-my-opencode.

## Command Loading

Commands are loaded from these directories (highest priority wins):

| Priority | Directory | Scope |
|----------|-----------|-------|
| 1 | `.opencode/command/` | Project-specific OpenCode commands |
| 2 | `.claude/commands/` | Claude Code project-specific commands |
| 3 | `~/.config/opencode/command/` | OpenCode global commands |
| 4 | `~/.claude/commands/` | Claude Code global commands |

## Categories

- [Workflow](#workflow) - Primary development flow
- [Quality](#quality) - Code quality and testing
- [Git & PRs](#git--prs) - Version control and pull requests
- [Research](#research) - Analysis and exploration
- [Project](#project) - Project management
- [Documentation](#documentation) - Documentation tools
- [Utilities](#utilities) - General utilities
- [Meta-Learning](#meta-learning) - Session learning

---

## Workflow

The primary development workflow follows this chain:

```
/specify → /plan → /tasks → /implement → /review → /test
```

### /specify

**Description:** Create or update feature specification from natural language

**Usage:**
```
/specify Add user authentication with OAuth2 and magic links
```

**Produces:** `spec.md` in the spec folder

**Next Step:** `/plan`

**Agent:** `product-strategist`

---

### /plan

**Description:** Create implementation plan from specification

**Usage:**
```
/plan
```

**Requires:** `spec.md`

**Produces:** `plan.md` with architecture, data models, and API design

**Next Step:** `/tasks`

**Agent:** `strategic-planner`

---

### /tasks

**Description:** Create task breakdown from implementation plan

**Usage:**
```
/tasks
```

**Requires:** `spec.md`, `plan.md`

**Produces:** `tasks.md` with phase-based task breakdown

**Next Step:** `/implement`

**Agent:** `task-planner`

---

### /implement

**Description:** Implement feature according to plan and tasks

**Usage:**
```
/implement
/implement T001  # Implement specific task
```

**Requires:** `spec.md`, `plan.md`, `tasks.md`

**Next Step:** `/review`

**Agent:** `implementation-specialist` (delegates to domain specialists)

---

### /review

**Description:** Review implementation from spec folder context

**Usage:**
```
/review
/review --security  # Focus on security
```

**Requires:** `spec.md`

**Next Step:** `/test`

---

### /test

**Description:** Write and run tests for implementation

**Usage:**
```
/test
/test --coverage 80  # Target 80% coverage
```

**Requires:** `spec.md`

**Agent:** `test-specialist`

---

### /scope-extend

**Description:** Create sub-issue from parent with linked branch and spec folder

**Usage:**
```
/scope-extend LIF-123 Add email notifications
```

**Produces:** New Linear sub-issue, branch, and spec folder

---

### /apply-analysis

**Description:** Apply analysis findings to spec documents with background validation

**Usage:**
```
/apply-analysis
```

**Produces:** Updated spec documents, `validation-ledger.json`

---

## Quality

### /code-review

**Description:** Perform thorough code review for functionality, maintainability, and security

**Usage:**
```
/code-review path/to/file.ts
/code-review --security
```

**Focus Areas:** Bugs, security vulnerabilities, performance, maintainability

---

### /write-unit-tests

**Description:** Create comprehensive unit tests with high coverage

**Usage:**
```
/write-unit-tests path/to/module
```

**Agent:** `test-specialist`

---

### /security-audit

**Description:** Comprehensive security review to identify and fix vulnerabilities

**Usage:**
```
/security-audit
/security-audit --scope auth
```

**Agent:** `security-specialist`

---

### /lint-fix

**Description:** Analyze code for linting issues and automatically fix them

**Usage:**
```
/lint-fix
/lint-fix path/to/directory
```

---

### /run-all-tests-and-fix

**Description:** Execute full test suite and systematically fix any failures

**Usage:**
```
/run-all-tests-and-fix
```

---

## Git & PRs

### /create-pr

**Description:** Create a well-structured pull request with proper description, labels, and reviewers

**Usage:**
```
/create-pr
/create-pr --base develop
```

**Integrates with:** Linear (updates issue status)

---

### /review-pr

**Description:** Comprehensive pull request review with security checks and actionable feedback

**Usage:**
```
/review-pr 123
/review-pr https://github.com/org/repo/pull/123
```

---

### /address-github-pr-comments

**Description:** Process PR reviewer feedback, apply fixes, and draft responses

**Usage:**
```
/address-github-pr-comments 123
```

---

### /create-prs-from-branches

**Description:** Analyze active branches and create PRs to GitHub with Linear integration

**Usage:**
```
/create-prs-from-branches
/create-prs-from-branches --dry-run
```

---

## Research

### /analyze

**Description:** Analyze feature specification, plan, or implementation for issues, improvements, or insights

**Usage:**
```
/analyze spec.md
/analyze --scope architecture
```

---

### /discuss

**Description:** Collaborative analytical partner for exploring ideas and problems

**Usage:**
```
/discuss Should we use GraphQL or REST for this API?
```

---

### /debug-issue

**Description:** Systematically debug issues with structured analysis and actionable solutions

**Usage:**
```
/debug-issue Users getting logged out randomly
```

---

### /clarify

**Description:** Clarify specification requirements that need clarification

**Usage:**
```
/clarify
```

Identifies `[NEEDS CLARIFICATION]` markers and generates questions.

---

### /optimize-performance

**Description:** Analyze code for performance bottlenecks and provide optimization recommendations

**Usage:**
```
/optimize-performance path/to/slow/module
```

**Agent:** `optimization-specialist`

---

## Project

### /init-project

**Description:** Initialize OpenCode configuration for new or existing projects

**Usage:**
```
/init-project
```

**Creates:** `.opencode/` directory with configuration files

---

### /update-context

**Description:** Manage project context files (constitution, architecture, tech-stack, glossary)

**Usage:**
```
/update-context constitution
/update-context tech-stack
/update-context --auto-detect
```

**Manages:** `.cursor/memory/` context files

---

### /sync-linear

**Description:** Sync local Linear artifacts (tasks, issues) with Linear workspace via Linear API

**Usage:**
```
/sync-linear
```

**Requires:** `LINEAR_API_KEY` environment variable

---

### /publish

**Description:** Publish oh-my-opencode to npm via GitHub Actions workflow

**Usage:**
```
/publish patch
/publish minor
/publish major
```

**Note:** Triggers GitHub Actions workflow_dispatch, never runs `bun publish` directly

---

### /get-unpublished-changes

**Description:** Compare HEAD with the latest published npm version and list all unpublished changes

**Usage:**
```
/get-unpublished-changes
```

---

## Documentation

### /add-documentation

**Description:** Add comprehensive documentation for code, features, or APIs

**Usage:**
```
/add-documentation path/to/module
```

**Agent:** `document-writer`

---

## Utilities

### /orchestrator

**Description:** Intelligent workflow orchestrator (delegates to orchestrator agent)

**Usage:**
```
/orchestrator Complex multi-step task description
```

**Agent:** `OmO` (team lead)

---

### /try-hard

**Description:** Create extensive, detailed plan with first-principles and chain-of-thought reasoning

**Usage:**
```
/try-hard Should we migrate to microservices?
```

Uses deep analysis with multi-dimensional thinking.

---

### /add-error-handling

**Description:** Implement comprehensive error handling for robust and resilient code

**Usage:**
```
/add-error-handling path/to/module
```

---

### /proceed

**Description:** A prompt for proceeding to next steps in a workflow

**Usage:**
```
/proceed
```

---

### /impl-plan

**Description:** Create a detailed implementation plan for an approach or feature

**Usage:**
```
/impl-plan Feature description
```

---

### /create-command

**Description:** Generate a new custom command based on workflow description and best practices

**Usage:**
```
/create-command my-workflow "Description of what it does"
```

**Creates:** New command file in `.opencode/command/`

---

### /checklist

**Description:** Create checklist for feature validation, quality assurance, or compliance

**Usage:**
```
/checklist release
/checklist security-audit
```

---

### /refactor-code

**Description:** Refactor selected code to improve quality while maintaining functionality

**Usage:**
```
/refactor-code path/to/file.ts
```

---

### /deep-review-project

**Description:** Full review of pending changes in the current branch with detailed analysis

**Usage:**
```
/deep-review-project
```

---

### /superwhisper-mode

**Description:** Generate or update a SuperWhisper custom mode for voice prompting with OpenCode

**Usage:**
```
/superwhisper-mode create opencode-developer
/superwhisper-mode update
/superwhisper-mode export
```

**Creates:** SuperWhisper mode configuration in `.opencode/templates/superwhisper/`

---

### /omomomo

**Description:** Easter egg command - about oh-my-opencode

**Usage:**
```
/omomomo
```

---

### /speckit-constitution

**Description:** DEPRECATED - Use /update-context instead

---

## Meta-Learning

### /extract-learnings

**Description:** Manually trigger meta-learning extraction from current session

**Usage:**
```
/extract-learnings
/extract-learnings path/to/transcript.jsonl
```

**Agent:** `context-learner`

---

### /review-learnings

**Description:** Review and approve/reject meta-learning candidates

**Usage:**
```
/review-learnings
/review-learnings --category orchestration
/review-learnings --min-confidence 0.8
```

---

## Command Structure

Each command is a Markdown file with:

### Frontmatter

```yaml
---
description: Command description
argument-hint: Usage hint
category: workflow|quality|git|research|project|utils
step: specify|plan|tasks|implement|review|test
requires: [spec.md, plan.md]
produces: [tasks.md]
next: next-command
linear_status: in_progress
---
```

### Body

The command prompt with special syntax:

| Syntax | Purpose |
|--------|---------|
| `$ARGUMENTS` | User-provided arguments |
| `@path/to/file` | Include file content |
| `` `!`command`` `` | Execute shell and include output |

## Creating Custom Commands

1. Create a file in `.opencode/command/my-command.md`
2. Add frontmatter with `description` and optional metadata
3. Write the command prompt in the body
4. Use the command with `/my-command [arguments]`

**Example:**

```markdown
---
description: Quick code review with security focus
argument-hint: [file path]
---

# Security-Focused Code Review

Review the following file for security vulnerabilities:

$ARGUMENTS

Focus on:
- SQL injection
- XSS vulnerabilities
- Authentication issues
- Authorization bypass
- Sensitive data exposure
```

## Related Resources

- [Agent System Architecture](../architecture/02-agent-system.md)
- [Workflow Orchestration](../architecture/14-workflow-orchestration.md)
- [SuperWhisper Integration](../guides/superwhisper-integration.md)
