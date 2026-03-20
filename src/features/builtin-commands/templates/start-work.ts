export const START_WORK_TEMPLATE = `You are starting a Sisyphus work session.

## ARGUMENTS

- \`/start-work [plan-name] [--worktree <path>]\`
  - \`plan-name\` (optional): name or partial match of the plan to start
  - \`--worktree <path>\` (optional): absolute path to an existing git worktree to work in
    - If specified and valid: hook pre-sets worktree_path in boulder.json
    - If specified but invalid: you must run \`git worktree add <path> <branch>\` first
    - If omitted: work directly in the current project directory (no worktree)

## WHAT TO DO

1. **Find available plans**: Search for Prometheus-generated plan files at \`.sisyphus/plans/\`

2. **Check for active boulder state**: Read \`.sisyphus/boulder.json\` if it exists

3. **Decision logic**:
   - If \`.sisyphus/boulder.json\` exists AND plan is NOT complete (has unchecked boxes):
     - **APPEND** current session to session_ids
     - Continue work on existing plan
   - If no active plan OR plan is complete:
     - List available plan files
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select

4. **Worktree Setup** (ONLY when \`--worktree\` was explicitly specified and \`worktree_path\` not already set in boulder.json):
   1. \`git worktree list --porcelain\` — see available worktrees
   2. Create: \`git worktree add <absolute-path> <branch-or-HEAD>\`
   3. Update boulder.json to add \`"worktree_path": "<absolute-path>"\`
   4. All work happens inside that worktree directory

5. **Create/Update boulder.json**:
   \`\`\`json
   {
     "active_plan": "/absolute/path/to/plan.md",
     "started_at": "ISO_TIMESTAMP",
     "session_ids": ["session_id_1", "session_id_2"],
     "plan_name": "plan-name",
     "worktree_path": "/absolute/path/to/git/worktree"
   }
   \`\`\`

6. **Read the plan file** and start executing tasks according to atlas workflow

## OUTPUT FORMAT

When listing plans for selection:
\`\`\`
Available Work Plans

Current Time: {ISO timestamp}
Session ID: {current session id}

1. [plan-name-1.md] - Modified: {date} - Progress: 3/10 tasks
2. [plan-name-2.md] - Modified: {date} - Progress: 0/5 tasks

Which plan would you like to work on? (Enter number or plan name)
\`\`\`

When resuming existing work:
\`\`\`
Resuming Work Session

Active Plan: {plan-name}
Progress: {completed}/{total} tasks
Sessions: {count} (appending current session)
Worktree: {worktree_path}

Reading plan and continuing from last incomplete task...
\`\`\`

When auto-selecting single plan:
\`\`\`
Starting Work Session

Plan: {plan-name}
Session ID: {session_id}
Started: {timestamp}
Worktree: {worktree_path}

Reading plan and beginning execution...
\`\`\`

## CRITICAL

- The session_id is injected by the hook - use it directly
- Always update boulder.json BEFORE starting work
- If worktree_path is set in boulder.json, all work happens inside that worktree directory
- Read the FULL plan file before delegating any tasks
- Follow atlas delegation protocols (7-section format)

## TASK BREAKDOWN (MANDATORY)

After reading the plan file, you MUST decompose every plan task into granular, implementation-level sub-steps and register ALL of them as task/todo items BEFORE starting any work.

**How to break down**:
- Each plan checkbox item (e.g., \`- [ ] Add user authentication\`) must be split into concrete, actionable sub-tasks
- Sub-tasks should be specific enough that each one touches a clear set of files/functions
- Include: file to modify, what to change, expected behavior, and how to verify
- Do NOT leave any task vague — "implement feature X" is NOT acceptable; "add validateToken() to src/auth/middleware.ts that checks JWT expiry and returns 401" IS acceptable

**Example breakdown**:
Plan task: \`- [ ] Add rate limiting to API\`
→ Todo items:
  1. Create \`src/middleware/rate-limiter.ts\` with sliding window algorithm (max 100 req/min per IP)
  2. Add RateLimiter middleware to \`src/app.ts\` router chain, before auth middleware
  3. Add rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining) to response in \`rate-limiter.ts\`
  4. Add test: verify 429 response after exceeding limit in \`src/middleware/rate-limiter.test.ts\`
  5. Add test: verify headers are present on normal responses

Register these as task/todo items so progress is tracked and visible throughout the session.

## WORKTREE COMPLETION

When working in a worktree (\`worktree_path\` is set in boulder.json) and ALL plan tasks are complete:
1. Commit all remaining changes in the worktree
2. Switch to the main working directory (the original repo, NOT the worktree)
3. Merge the worktree branch into the current branch: \`git merge <worktree-branch>\`
4. If merge succeeds, clean up: \`git worktree remove <worktree-path>\`
5. Remove the boulder.json state

This is the DEFAULT behavior when \`--worktree\` was used. Skip merge only if the user explicitly instructs otherwise (e.g., asks to create a PR instead).`
