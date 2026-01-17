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
- [ ] Code reviewed (self or Codex)
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
