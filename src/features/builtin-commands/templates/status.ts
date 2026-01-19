/**
 * /status Command Template
 *
 * Displays current change execution status including:
 * - Active change name
 * - Task completion progress
 * - Recent commit SHAs
 * - Current worktree branch
 */

export const STATUS_TEMPLATE = `# /status Command

Display the current change execution status.

## Execution Logic

1. **Check for .sisyphus/boulder.json**
   - If not found, check for \`changes/\` directory with active changes
   - If no active change, report "No active change"

2. **Read status data**
   - Active change name from \`.sisyphus/boulder.json\` or detect from \`changes/\` directory
   - Parse \`changes/{name}/tasks.md\` for task progress

3. **Parse task progress**
   - Count \`- [x]\` as completed
   - Count \`- [ ]\` as pending
   - Count \`- [/]\` as in-progress
   - Detect \`<!-- blocked -->\` markers

4. **Check git state**
   - Current branch: \`git branch --show-current\`
   - Recent commits: \`git log --oneline -5\`
   - Worktree status: \`git worktree list\`

5. **Format output**

\`\`\`
📊 Status: {change-name}

Progress: {completed}/{total} tasks ({percent}%)
├─ ✅ Task 1.1: {description} (sha: {sha})
├─ ✅ Task 1.2: {description} (sha: {sha})
├─ 🔄 Task 2.1: {description} (in progress)
└─ ⏳ Task 2.2: {description} (pending)

Worktree: .worktrees/{change-name}
Branch: feature/{change-name}
\`\`\`

## No Active Change

If no active change is found:

\`\`\`
📊 Status: No active change

To start a new change:
1. Use the brainstorming skill to explore requirements
2. Use the creating-changes skill to create design.md + tasks.md

Available changes in changes/:
  - {change1}
  - {change2}
\`\`\`

## Error Handling

- If \`.sisyphus/\` doesn't exist: Check \`changes/\` directory directly
- If \`changes/\` doesn't exist: Report "No changes directory found"
- If tasks.md is malformed: Report parse errors and show raw content
`
