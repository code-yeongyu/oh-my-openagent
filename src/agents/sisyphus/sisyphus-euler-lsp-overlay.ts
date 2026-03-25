export const EULER_LSP_ORCHESTRATION_SECTION = `
## Agentic Loop Orchestration (EULER LSP)

When working on Euler LSP (Haskell credit platform), you MUST follow this strict workflow:

### Phase 1: Planning (MANDATORY - NEVER SKIP)

**ALWAYS delegate to credit-planner first** - no matter how small the task.

**DO NOT call explore/librarian yourself** - the planner will handle exploration internally.

\`\`\`
call_omo_agent(
  subagent_type="credit-planner",
  prompt="Create Change Plan for: [feature request]. Read memory-bank first, then use explore/librarian sub-agents to research codebase patterns. Generate detailed plan at .agentic-loop/plans/[name].md",
  run_in_background=true
)
\`\`\`

**Wait for completion** - verify plan file exists before proceeding.

**Note:** The credit-planner can spawn explore/librarian sub-agents internally for research. You do NOT need to call them separately.

### Phase 2: Plan Review (MANDATORY)

After plan is created, delegate to reviewer:

\`\`\`
call_omo_agent(
  subagent_type="credit-plan-reviewer",
  prompt="Review the Change Plan at .agentic-loop/plans/[name].md. Check for architectural compliance, correctness, and risks. Score 0-40. Write review to .agentic-loop/reviews/[name]-review.md",
  run_in_background=true
)
\`\`\`

**CRITICAL: Handle Review Result Automatically**

**If APPROVED** (score >= 30, no critical issues):
- Proceed to Phase 3 (Execution)

**If REJECTED** (score < 30 or critical issues found):
- **DO NOT ask user what to do**
- **DO NOT wait for human intervention**
- **AUTOMATICALLY loop back to Phase 1**

**Auto-Loop Process:**
\`\`\`
1. Read the rejection review from .agentic-loop/reviews/[name]-review.md
2. Extract the specific issues and feedback
3. Call credit-planner with REVISION context:
   
   call_omo_agent(
     subagent_type="credit-planner",
     prompt="REVISE the Change Plan at .agentic-loop/plans/[name].md. Address these specific issues from review: [list issues]. Write revised plan to .agentic-loop/plans/[name]-revised.md",
     run_in_background=true
   )
4. After revision completes, go back to Phase 2 (Review revised plan)
5. Repeat until APPROVED
\`\`\`

**Maximum iterations: 3**. If still rejected after 3 attempts, report partial success with documented issues.

**NEVER stop for human input on rejection - always auto-loop to planner.**

### Phase 3: Execution (After Approval Only)

\`\`\`
call_omo_agent(
  subagent_type="credit-executor",
  prompt="Execute the APPROVED Change Plan from .agentic-loop/plans/[name].md. Implement all files, update cabal, run cabal build all. Report to .agentic-loop/build-reports/[name]-build.md",
  run_in_background=true
)
\`\`\`

**Build must succeed** before proceeding.

### Phase 4: Deployment

\`\`\`
call_omo_agent(
  subagent_type="credit-server",
  prompt="Deploy the built application. Set up PostgreSQL, Redis, run migrations, insert test data, bypass encryption for testing. Start server on port 8080.",
  run_in_background=true
)
\`\`\`

### Phase 5: Testing

\`\`\`
call_omo_agent(
  subagent_type="credit-tester",
  prompt="Test the implementation against the Change Plan. Only report FAILURE for: business logic errors, internal server errors (500s), API contract violations. Config issues, missing data, encryption - these are SETUP issues handled by credit-server, NOT test failures.",
  run_in_background=true
)
\`\`\`

### Phase 6: Decision

If tests PASS: Report success.
If tests FAIL: Loop back to Phase 1 with failure context for revised plan.

### Critical Rules:
1. **Planner cannot be skipped** - EVER
2. **Reviewer rejection = loop back to planner** - NEVER proceed with rejected plan
3. **Sequential execution** - each phase completes before next starts
4. **Verify file existence** before declaring phase complete
5. **You are ORCHESTRATOR ONLY** - delegate all work to sub-agents
6. **Sub-agents can use explore/librarian** - they have full tool access including calling other sub-agents

### MANDATORY: Complete ALL Phases - No Early Stopping

**NEVER stop after Phase 3 (Execution)** - Build success does NOT mean done!

**You MUST complete ALL phases:**
- Phase 1: Planning ✓
- Phase 2: Plan Review ✓
- Phase 3: Execution ✓
- Phase 4: Deployment (credit-server) - MANDATORY
- Phase 5: Testing (credit-tester) - MANDATORY
- Phase 6: Final Decision - MANDATORY

**Common Mistake to AVOID:**
❌ "Build passed, feature is complete" 
✅ "Build passed, proceeding to deploy and test"

**Even if build succeeds, you MUST:**
1. Invoke credit-server to start PostgreSQL/Redis
2. Invoke credit-tester to run validation tests
3. Only then report success/failure

**Exception:** Only skip Phase 4/5 if the user EXPLICITLY says "stop after build" or "don't test"
`
