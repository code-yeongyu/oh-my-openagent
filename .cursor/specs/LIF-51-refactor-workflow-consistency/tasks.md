# Tasks: Workflow Consistency Remediation

**Input**: Plan from `.cursor/plans/branch-workflow-review_944a677f.plan.md`  
**Prerequisites**: plan.md (reference), spec.md (requirements)

**Organization**: Tasks follow the phased approach from the main plan.

## Phase 0: Linear Tracking & Spec Folder

- [x] T001 Create Linear issue "Workflow consistency remediation" (label `type:refactor`)
- [x] T002 Set Linear issue status to `In Progress`
- [x] T003 Create `.cursor/specs/LIF-51-refactor-workflow-consistency/` scaffold

## Phase 1: Jira Removal (Linear-only enforcement)

- [ ] T010 Identify all files containing Jira/mcp-atlassian references
- [ ] T011 Update `.cursor/commands/conductor.md` to remove Jira from workflows and agent catalog
- [ ] T012 Archive `.cursor/agents/jira-coordinator.md` (move under `.cursor/agents/_archive/` or delete)
- [ ] T013 Fix `.cursor/agents/WORKFLOW_PATTERNS.md` Step 3 to be Linear-only (remove Jira wording and `mcp-atlassian`)
- [ ] T014 Fix `.cursor/agents/FEATURE_WORKFLOW.md` to remove Jira references and correct `.cursor/specs/{feature-id}/...` paths
- [ ] T015 Fix `.cursor/agents/QUICK_START.md` to reflect canonical `{ISSUE-ID}-{type}-{name}` folders
- [ ] T016 Update `.cursor/templates/plan-template.md` to use `linear/` (not `jira/`)
- [ ] T017 Update `.cursor/agents/historian.md` to replace `Jira:` field/examples with `Linear:` (or generic Issue)

## Phase 2: Legacy `speckit.*` Commands (true forwarding)

- [ ] T020 Rewrite `.cursor/commands/speckit.specify.md` as a minimal alias: "defer to `/specify`" (remove `.specify/` instructions)
- [ ] T021 Rewrite `.cursor/commands/speckit.plan.md` as a minimal alias: "defer to `/plan`"
- [ ] T022 Rewrite `.cursor/commands/speckit.tasks.md` as a minimal alias: "defer to `/tasks`"
- [ ] T023 Rewrite `.cursor/commands/speckit.clarify.md` as a minimal alias: "defer to `/clarify`"
- [ ] T024 Rewrite `.cursor/commands/speckit.checklist.md` as a minimal alias: "defer to `/checklist`"
- [ ] T025 Rewrite `.cursor/commands/speckit.analyze.md` as a minimal alias: "defer to `/analyze`"
- [ ] T026 Rewrite `.cursor/commands/speckit.implement.md` as a minimal alias: "defer to `/implement`"
- [ ] T027 Decide what to do with `.cursor/commands/speckit.taskstoissues.md` (likely deprecate in favor of Linear sync)
- [ ] T028 Fix `.cursor/commands/speckit.constitution.md` to either (a) deprecate fully, or (b) update to `.cursor/memory/constitution.md` (remove `.specify/`)

## Phase 3: Broken References (rules/templates/docs)

- [ ] T030 Enumerate all references to non-existent `.cursor/rules/00-core/*` and decide: update references vs create missing rule files
- [ ] T031 Fix `.cursor/rules` broken link in `.cursor/rules/simplicity-first.mdc` (remove/replace `mdc:.cursor/rules/00-core/verification.mdc`)
- [ ] T032 Fix broken rule references in `.cursor/agents/context-steward.md` to point to existing rules (or create the referenced rule files)
- [ ] T033 Fix broken template references in `.cursor/agents/historian.md` (replace `.cursor/specs/_templates/...` with `.cursor/templates/...`)
- [ ] T034 Fix broken template references in `.cursor/agents/linear-coordinator.md` (replace `.cursor/specs/_templates/...` with `.cursor/templates/...` or add missing templates)
- [ ] T035 Audit `.cursor/agents/COMPLETE_INDEX.md` and either (a) prune to match what actually exists, or (b) add the missing referenced files
- [ ] T036 Audit `.cursor/agents/agents.json` project context and make it project-agnostic or poly-fun-specific

## Phase 4: Spec Root Migration (`specs/` → `.cursor/specs/`)

- [ ] T040 Create target folder `.cursor/specs/001-feat-polymarket-trading-bot/`
- [ ] T041 Move `specs/001-polymarket-trading-bot/*` into `.cursor/specs/001-feat-polymarket-trading-bot/`
- [ ] T042 Update any references pointing at `specs/001-polymarket-trading-bot/` to the new path
- [ ] T043 Add a deprecation note in `specs/` (README or placeholder) stating specs are now under `.cursor/specs/`

## Phase 5: Validation Tooling Alignment

- [ ] T050 Update `extract_agent_paths.py` to extract `.cursor/specs/`, `.cursor/templates/`, and `.cursor/rules/` references (not `chat-context/`)
- [ ] T051 Update `build_structure.py` path classification to reflect `.cursor/specs` and template locations
- [ ] T052 Update `generate_outputs.py` report language to reflect Linear-only and `.cursor/specs`
- [ ] T053 Regenerate `context_structure.yaml` and `validation_report.md` from the updated scripts

## Phase 6: Repository Hygiene

- [ ] T060 Decide whether `research/` should be removed from git history (since `.gitignore` now ignores it) or kept tracked
- [ ] T061 Expand `.gitignore` to include standard language/tooling ignores used by this repo (if applicable)

## Phase 7: Final Verification

- [ ] T070 Run repo-wide grep checks to ensure:
  - No `mcp-atlassian` / Jira references remain outside archives
  - No `.specify/` references remain in `.cursor/commands/`
  - No references to non-existent `.cursor/templates/...` or `.cursor/rules/...` paths
- [ ] T071 Validate command-driven workflow paths match `.cursor/scripts/WORKFLOW_CONTRACT.md`
- [ ] T072 Add completion changelog entry via Historian for the remediation work

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0**: No dependencies - can start immediately ✅
- **Phase 1**: Depends on Phase 0 completion
- **Phase 2**: Can run in parallel with Phase 1 (different files)
- **Phase 3**: Depends on Phase 1 completion (fixes references after Jira removal)
- **Phase 4**: Can run in parallel with other phases (isolated migration)
- **Phase 5**: Depends on Phase 4 completion (needs migrated structure)
- **Phase 6**: Can run anytime (repository hygiene)
- **Phase 7**: Depends on all previous phases (final verification)

### Parallel Opportunities

- Phase 1 and Phase 2 can run in parallel (different file sets)
- Phase 3 tasks can run in parallel (different files)
- Phase 4 is isolated and can run anytime after Phase 0

