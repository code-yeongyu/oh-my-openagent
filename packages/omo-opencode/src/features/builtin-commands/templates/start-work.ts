export const START_WORK_TEMPLATE = `You are starting an Atlas work session.

## ARGUMENTS

- \`/start-work [plan-name] [--worktree <path>] [--make-pr] [--ship]\`
  - \`plan-name\` (optional): name or partial match of the plan to start
  - \`--worktree <path>\` (optional): absolute path to an existing git worktree to work in
    - If specified and valid: hook pre-sets worktree_path in boulder.json
    - If specified but invalid: you must run \`git worktree add <path> <branch>\` first
    - If omitted: work directly in the current project directory (no worktree)
  - \`--make-pr\` (optional): deliver the work as a pull request. IMPLIES worktree mode - when \`--worktree\` is omitted, create a task-owned worktree before implementation. On completion push the branch, open a reviewer-readable PR, and hand off with the PR URL (merge only on explicit user ask)
  - \`--ship\` (optional): full delivery lifecycle; implies \`--make-pr\`. After the PR opens, keep working until it is MERGED (CI + review gates, feedback addressed), then clean up the worktree and sync \`.omo/\` state back

## WHAT TO DO

1. **Find available plans**: Search for Prometheus-generated plan files at \`.omo/plans/\`

2. **Check for active boulder state**: Read \`.omo/boulder.json\` if it exists

3. **Decision logic**:
   - If multiple active works are listed in your context:
     - This means boulder.json has more than one work with status: \`active\` or \`paused\`
     - Use the Question tool to ask the user which plan to resume
     - Resume by running \`/start-work {plan-name}\` for the selected plan
     - If the user says "start a new plan", continue with cold-start auto-selection logic
   - If exactly one active work is listed and the user did not name a plan:
     - Auto-resume that single active work
   - If no active plan OR plan is complete:
     - List available plan files
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select

4. **Worktree Setup** (ONLY when \`--worktree\` was explicitly specified and \`worktree_path\` not already set in boulder.json):
   1. \`git worktree list --porcelain\` - see available worktrees
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

## GOAL + TASK BREAKDOWN (MANDATORY)

Do BOTH of these immediately after reading the plan file, BEFORE starting any work. Skipping either is a defect.

**1. Set the goal, in detail.** When a goal tool is available (\`create_goal\`), call it with a DETAILED objective: the plan name and path, the concrete end state, the phase/task counts, the delivery mode (direct, \`--make-pr\`, or \`--ship\`), and how completion will be verified. One work session = one goal. No goal tool -> record the same objective as the first \`.omo/start-work/ledger.jsonl\` entry.

**2. Register every phase and task as todos.** Decompose every plan task into granular, implementation-level sub-steps and register ALL of them as task/todo items, grouped phase by phase (one phase per plan wave), BEFORE starting any work. Keep them current at every moment: mark in_progress when work dispatches and done immediately after its verification passes - never batch-complete at the end, never execute work that is not a registered todo. Discovered work is appended as a todo before it runs.

**How to break down**:
- Each plan checkbox item (e.g., \`- [ ] Add user authentication\`) must be split into concrete, actionable sub-tasks
- Sub-tasks should be specific enough that each one touches a clear set of files/functions
- Include: file to modify, what to change, expected behavior, and how to verify
- Do NOT leave any task vague - "implement feature X" is NOT acceptable; "add validateToken() to src/auth/middleware.ts that checks JWT expiry and returns 401" IS acceptable

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
2. **Sync .omo state back**: Copy \`.omo/\` from the worktree to the main repo before removal.
   This is CRITICAL when \`.omo/\` is gitignored - state written during worktree execution would otherwise be lost.
   \`\`\`bash
   cp -r <worktree-path>/.omo/* <main-repo>/.omo/ 2>/dev/null || true
   \`\`\`
3. Switch to the main working directory (the original repo, NOT the worktree)
4. Merge the worktree branch into the current branch: \`git merge <worktree-branch>\`
5. If merge succeeds, clean up: \`git worktree remove <worktree-path>\`
6. Remove the boulder.json state

This is the DEFAULT behavior when \`--worktree\` was used alone. When \`--make-pr\` or \`--ship\` is active, skip the local merge and follow the PR Delivery Mode instructions in the session context instead: push the branch and open a PR (\`--make-pr\` hands off with the PR URL; \`--ship\` keeps working until the PR is merged), then clean up. Otherwise skip merge only if the user explicitly instructs otherwise (e.g., asks to create a PR instead).`
