# Command Mapping Matrix: Cursor → Open Code

## Mapping Rules
- Cursor: `.cursor/commands/{command}.md` (references `.cursor/agents/{agent}.md`)
- Open Code: `.opencode/command/{command}.md` (references `.opencode/agent/{category}/{agent}.md`)

## Command Inventory

### Cursor Commands (33 total)
**Phase Commands** (core spec-driven workflow):
1. `specify.md` → `.opencode/command/specify.md` ✅ (already exists, references updated)
2. `plan.md` → `.opencode/command/plan.md` ✅ (already exists, references updated)
3. `tasks.md` → `.opencode/command/tasks.md` ✅ (already exists, references updated)
4. `implement.md` → `.opencode/command/implement.md` ✅ (already exists, references updated)

**Orchestrator**:
5. `conductor.md` → `.opencode/agent/orchestrator.md` (agent, not command) + `.opencode/command/orchestrator.md` (NEW - needs creation)
6. `conductor.help.md` → Not migrated (help docs can be added to orchestrator.md)

**Other Commands** (not in Open Code - may not need migration):
- `1-deep-review-project.md`, `add-documentation.md`, `add-error-handling.md`, `address-github-pr-comments.md`, `analyze.md`, `checklist.md`, `clarify.md`, `code-review.md`, `create-command.md`, `create-pr.md`, `create-prs-from-branches.md`, `debug-issue.md`, `discuss.md`, `impl-plan.md`, `lint-fix.md`, `NR-review-pr.md`, `optimize-performance.md`, `proceed.md`, `refactor-code.md`, `run-all-tests-and-fix.md`, `security-audit.md`, `speckit.constitution.md`, `superwhisper-mode.md`, `sync-linear.md`, `try-hard.md`, `update-context.md`, `write-unit-tests.md`

### Open Code Commands (6 total)
1. `specify.md` ✅ (references `.opencode/agent/planning/product-strategist.md`)
2. `plan.md` ✅ (references `.opencode/agent/planning/strategic-architect.md`)
3. `tasks.md` ✅ (references `.opencode/agent/planning/linear-coordinator.md`)
4. `implement.md` ✅ (references `.opencode/agent/implementation/implementation-specialist.md`)
5. `init-project.md` - Unique to Open Code
6. `superwhisper-mode.md` - Unique to Open Code

### Missing in Open Code
- `orchestrator.md` command wrapper (needs creation)

## Reference Differences

### Cursor Commands Reference Pattern
- `.cursor/agents/{agent}.md` (flat structure)
- Example: `.cursor/agents/product-strategist.md`

### Open Code Commands Reference Pattern
- `.opencode/agent/{category}/{agent}.md` (categorized structure)
- Example: `.opencode/agent/planning/product-strategist.md`

### Shared Resources (Unchanged in Both)
- `.cursor/specs/` - Spec folders
- `.cursor/memory/` - Constitution, architecture
- `.cursor/templates/` - Templates
- `.cursor/scripts/` - Bash scripts

## Verification Status

### Already Updated ✅
- `specify.md` - References `.opencode/agent/governance/context-steward.md` and `.opencode/agent/planning/product-strategist.md`
- `plan.md` - References `.opencode/agent/planning/strategic-architect.md`
- `tasks.md` - Needs verification
- `implement.md` - Needs verification

### Needs Creation
- `orchestrator.md` - Command wrapper for orchestrator agent



