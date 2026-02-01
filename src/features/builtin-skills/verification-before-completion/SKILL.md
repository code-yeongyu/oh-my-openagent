# Skill: verification-before-completion

## Purpose

Verify deliverables meet acceptance criteria, are test-validated, and ready for handoff or archival.

## When to Use

- Before marking any task/phase complete
- Prior to archival or handoff
- Final quality gate

## Steps

1. **Acceptance check**: Compare outputs to task acceptance criteria
2. **Test validation**: Run required test suites; capture results; ensure no skipped tests
3. **Static analysis**: Lint/typecheck if applicable; scan for TODOs/FIXMEs
4. **Documentation**: Update relevant notes, READMEs, or changelogs
5. **Ready signal**: Confirm clean state (`git status --short`), note outstanding risks

## Checklist

```markdown
## Verification Checklist

- [ ] Acceptance criteria satisfied
- [ ] All tests passing (no skips)
- [ ] Linters clean (ESLint, TypeScript)
- [ ] No stray debug logs or console.log
- [ ] TODOs addressed or documented
- [ ] README/docs updated if needed
- [ ] Commit messages follow convention
- [ ] Code reviewed (self or via collaborating-with-codex skill)
```

## Verification Commands

```bash
# TypeScript/JavaScript
npm run typecheck           # Type checking
npm run lint                # Linting
npm test                    # Unit tests

# Python
python -m pytest            # Tests
python -m mypy .            # Type checking
python -m flake8 .          # Linting

# Go
go test ./...               # Tests
go vet ./...                # Static analysis

# General
git status --short          # Uncommitted changes
git diff --stat HEAD~1      # Recent changes summary
```

## Known Gaps Documentation

If gaps remain, document with owners:

```markdown
## Known Gaps

| Gap | Owner | Timeline |
|-----|-------|----------|
| Edge case X not tested | @dev | Next sprint |
| API rate limiting needed | @dev | Before prod |
```

## Codex Contribution Summary

If Codex was involved, summarize:

```markdown
## Codex Contributions

- Task 1.2: Generated initial implementation prototype
- Task 2.1: Code review identified null pointer issue
- Task 2.3: Suggested optimization for loop performance

Unverified areas: None
```

---

## Manus Principles Integration

### 5-File Completeness Check

When verifying a change that used the creating-changes workflow, confirm all 5 files exist and are current:

```markdown
## File Completeness Checklist

- [ ] `changes/{name}/proposal.md` - Initial proposal exists
- [ ] `changes/{name}/design.md` - Design document complete
- [ ] `changes/{name}/tasks.md` - All tasks marked [x] or [-]
- [ ] `changes/{name}/findings.md` - Research findings documented
- [ ] `changes/{name}/progress.md` - Progress log updated with final status
```

### Progress Log Final Entry

Before marking complete, ensure `progress.md` has a final summary:

```markdown
## Final Status

**Completed:** YYYY-MM-DD HH:MM

### Summary
- Total tasks: N
- Completed: N
- Cancelled: 0

### Test Results
| Suite | Status |
|-------|--------|
| Unit tests | ✅ Pass |
| Type check | ✅ Pass |
| Build | ✅ Pass |

### Known Issues
None (or list any deferred items)
```

---

## Next Step

After verification is complete and all checks pass:

| Condition | Next Skill | Action |
|-----------|------------|--------|
| All checks passed | `finishing-a-development-branch` | `skill("finishing-a-development-branch")` to present merge/PR options |

**REQUIRED:** Invoke finishing-a-development-branch to complete the integration workflow.
