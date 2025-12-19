# Tasks: Test Workflow and Command

**Input**: Design documents from `.cursor/specs/003-feat-test-workflow/`
**Prerequisites**: plan.md ✅, spec.md ✅

**Tests**: Manual verification - no automated tests required for this workflow validation feature.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, or SETUP/EDGE
- Include exact file paths in descriptions

---

## Phase 1: Setup (Verification Prerequisites)

**Purpose**: Verify all required components exist before testing workflow

- [ ] T001 [P] [SETUP] Verify `.cursor/scripts/bash/setup-specify.sh` exists
- [ ] T002 [P] [SETUP] Verify `.cursor/commands/specify.md` command definition exists
- [ ] T003 [P] [SETUP] Verify `.cursor/agents/product-strategist.md` agent exists
- [ ] T004 [P] [SETUP] Verify `.cursor/templates/spec-template.md` exists

**Checkpoint**: All required files exist - can proceed with testing

---

## Phase 2: User Story 1 - Execute `/specify` Command Successfully (P1) 🎯 MVP

**Goal**: Developer executes `/specify` and receives complete spec document

**Independent Test**: Run `/specify` with simple feature description, verify all artifacts created

### Verification Tasks

- [ ] T005 [US1] Execute `setup-specify.sh --json "test feature"` and capture JSON output
- [ ] T006 [US1] Verify JSON output contains BRANCH_NAME field with format `{NNN}-{name-slug}`
- [ ] T007 [US1] Verify JSON output contains SPEC_DIR with path `.cursor/specs/{NNN}-{type}-{name}/`
- [ ] T008 [US1] Verify JSON output contains SPEC_FILE pointing to valid `spec.md`

### Artifact Validation

- [ ] T009 [US1] Verify git branch created (or graceful skip on existing branch)
- [ ] T010 [US1] Verify spec folder exists at SPEC_DIR path from JSON
- [ ] T011 [US1] Verify `spec.md` file created in spec folder
- [ ] T012 [US1] Verify `spec.md` contains template sections (user stories, requirements, success criteria)

### Success Criteria Validation

- [ ] T013 [US1] Measure command execution time (target: <5 seconds)
- [ ] T014 [US1] Validate spec folder follows canonical format `{NNN}-{type}-{name-slug}`

**Checkpoint**: US1 complete - `/specify` command creates all required artifacts

---

## Phase 3: User Story 2 - Validate Workflow Integration (P2)

**Goal**: Verify governance agents execute correctly during `/specify`

**Independent Test**: Trace agent execution sequence through artifacts

### Context Steward Validation

- [ ] T015 [US2] Verify spec folder name follows canonical pattern `{NNN}-{type}-{name}`
- [ ] T016 [US2] Verify path is within `.cursor/specs/` directory

### Product Strategist Validation

- [ ] T017 [US2] Verify `spec.md` created with mandatory sections (not placeholders)
- [ ] T018 [US2] Verify user stories section has content
- [ ] T019 [US2] Verify requirements section has content
- [ ] T020 [US2] Verify success criteria section has content

### Historian Validation

- [ ] T021 [US2] Verify `changelog/` directory exists in spec folder
- [ ] T022 [US2] Verify changelog entry created with format `YYYY-MM-DD__product-strategist__*.md`
- [ ] T023 [US2] Verify `changelog/index.md` exists and references entry

**Checkpoint**: US2 complete - All governance agents executed correctly

---

## Phase 4: Edge Case Validation

**Goal**: Verify graceful handling of edge cases

### No Git Repository

- [ ] T024 [EDGE] Test `setup-specify.sh` in directory without `.git/`
- [ ] T025 [EDGE] Verify branch creation skipped (no error)
- [ ] T026 [EDGE] Verify spec folder still created

### Existing Spec Folder

- [ ] T027 [EDGE] Test with spec folder that already exists
- [ ] T028 [EDGE] Verify reuse or conflict handled gracefully

### Long Feature Name

- [ ] T029 [EDGE] Test with feature name >200 characters
- [ ] T030 [EDGE] Verify truncation occurs and warning displayed

### Missing Template

- [ ] T031 [EDGE] Test with missing `.cursor/templates/spec-template.md`
- [ ] T032 [EDGE] Verify empty `spec.md` created (not crash)

**Checkpoint**: Edge cases handled gracefully

---

## Phase 5: Polish & Documentation

**Purpose**: Complete feature with documentation updates

- [ ] T033 [P] Update feature status in `.cursor/specs/003-feat-test-workflow/status.md`
- [ ] T034 [P] Document test results in spec folder
- [ ] T035 Complete final changelog entry via Historian

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - verify prerequisites first
- **Phase 2 (US1)**: Depends on Phase 1 - core functionality test
- **Phase 3 (US2)**: Depends on Phase 2 - governance validation
- **Phase 4 (Edge)**: Independent - can run parallel with US2
- **Phase 5 (Polish)**: After all testing complete

### Parallel Opportunities

- All Phase 1 tasks marked [P] can run in parallel
- Phase 4 (Edge Cases) can run parallel with Phase 3 (US2)
- All tasks within same [P] group are independent

### User Story Independence

- **US1 (P1)**: Can be validated independently - MVP
- **US2 (P2)**: Depends on US1 artifacts but tests different aspects
- **Edge cases**: Independent validation of error handling

---

## Summary

| Phase | Tasks | Story | Status |
|-------|-------|-------|--------|
| 1. Setup | T001-T004 | SETUP | Pending |
| 2. US1 | T005-T014 | P1 🎯 MVP | Pending |
| 3. US2 | T015-T023 | P2 | Pending |
| 4. Edge | T024-T032 | EDGE | Pending |
| 5. Polish | T033-T035 | POLISH | Pending |

**Total Tasks**: 35
**Ready for**: `/implement`

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps to user story for traceability
- Verify at checkpoints before proceeding
- Manual testing - no automated test framework needed
- Edge cases can be tested independently







