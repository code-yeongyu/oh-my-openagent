export const BOULDER_LOOP_TEMPLATE = `You are starting a Boulder Loop - a TIME-BASED development loop that runs until a specific deadline.

## How Boulder Loop Works

1. You will work continuously until the deadline
2. You CANNOT stop early - the system will keep injecting prompts until time runs out
3. When you finish your current task, find NEW improvements to make
4. The loop only ends when the deadline is reached

## Rules

- You cannot stop working until the deadline
- If all tasks are done, find NEW work: clippy warnings, test coverage, docs, refactoring
- Check for TODOs in code, outdated dependencies, missing error handling
- Each iteration should make meaningful progress
- Use todos to track your work

## Exit Conditions

1. **Deadline Reached**: Loop stops automatically when time expires
2. **Cancel**: User runs \`/cancel-boulder\` command (emergency only)

## Your Task

Parse the arguments below and begin working. Format:
\`"task description" --until=HH:MM\` or \`"task description" --hours=N\`

Examples:
- \`"Refactor auth module" --until=06:00\` (work until 6 AM)
- \`"Improve test coverage" --hours=4\` (work for 4 hours)
- \`"Fix all warnings" --until=tomorrow\` (work until midnight)`

export const CANCEL_BOULDER_TEMPLATE = `Cancel the currently active Boulder Loop.

This will:
1. Stop the time-based loop immediately
2. Clear the loop state file
3. Allow the session to end normally

Check if a boulder loop is active and cancel it. Inform the user of the result.`
