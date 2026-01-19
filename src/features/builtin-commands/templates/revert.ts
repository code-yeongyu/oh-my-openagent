/**
 * /revert Command Template
 *
 * Reverts to a previous checkpoint with three-level granularity:
 * - Task level: Revert a single task's commit
 * - Phase level: Revert all commits from a phase
 * - Change level: Revert entire change
 */

export const REVERT_TEMPLATE = `# /revert Command

Revert to a previous checkpoint.

## Usage

\`\`\`
/revert                    # List available checkpoints
/revert task <id>          # Revert single task (e.g., /revert task 2.1)
/revert phase <n>          # Revert entire phase (e.g., /revert phase 2)
/revert change             # Revert entire current change
\`\`\`

## Execution Logic

### List Mode (no arguments)

1. **Find checkpoints from git log**
   \`\`\`bash
   git log --oneline --grep="feat(task-" --grep="chore(phase-" -20
   \`\`\`

2. **Parse commit messages** to identify:
   - Task commits: \`feat(task-X.Y): description\`
   - Phase commits: \`chore(phase-X): description\`
   - Change start: First commit after branching

3. **Display revert options**
   \`\`\`
   🔄 Revert Options:
   
   1. Task 2.2 (sha: jkl012) - 5 mins ago
   2. Task 2.1 (sha: ghi789) - 15 mins ago
   3. Phase 2 start (sha: def456) - 30 mins ago
   4. Phase 1 start (sha: abc123) - 1 hour ago
   5. Before change (sha: xyz000) - 2 hours ago
   
   Select checkpoint (1-5): _
   \`\`\`

### Task Revert

1. **Find task commit**
   \`\`\`bash
   git log --oneline --grep="feat(task-{id}):" -1
   \`\`\`

2. **Revert the commit**
   \`\`\`bash
   git revert --no-edit <sha>
   \`\`\`

3. **Update status** - Mark task as pending in tasks.md

### Phase Revert

1. **Find all task commits in phase**
   \`\`\`bash
   git log --oneline --grep="feat(task-{n}\\." 
   \`\`\`

2. **Revert in reverse order**
   \`\`\`bash
   git revert --no-edit <sha_n>
   git revert --no-edit <sha_n-1>
   ...
   \`\`\`

3. **Update status** - Mark all phase tasks as pending

### Change Revert

1. **Find change start point**
   - Look for branch point or first task commit

2. **Confirm with user** - This is destructive!
   \`\`\`
   ⚠️ This will revert ALL commits in the current change.
   Commits to revert: 12
   
   Proceed? (yes/no): _
   \`\`\`

3. **Revert all commits** in reverse order

4. **Clean up**
   - Remove worktree if exists
   - Update .sisyphus/boulder.json
   - Optionally delete change directory

## Error Handling

- **Revert conflict**: 
  \`\`\`
  ⚠️ Conflict in <file>. 
  Resolve manually and run: git revert --continue
  Or abort with: git revert --abort
  \`\`\`

- **Commit not found**: Search for similar commit messages
- **Already reverted**: Warn and skip

## Completion

Report summary:
- Number of commits reverted
- Current HEAD SHA
- Next steps (e.g., "Run tests to verify")
`
