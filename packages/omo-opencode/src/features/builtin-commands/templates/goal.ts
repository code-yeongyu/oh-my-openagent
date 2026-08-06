export const GOAL_TEMPLATE = `You are setting a thread Goal - a persistent objective that the agent will pursue continuously until paused, cleared, or completed.

## How Goal Works

1. The goal stays active for this thread/session
2. When idle, the system will automatically inject a continuation prompt to keep working toward the goal
3. The agent can call update_goal({ status: "complete" }) when the objective is actually achieved
4. You can pause, resume, or clear the goal with /goal pause, /goal resume, /goal clear

## Rules

- Focus on completing the objective fully, not partially
- Do not mark the goal complete until a completion audit confirms it is done
- Each turn should make meaningful progress toward the goal
- If stuck, try different approaches
- Use todos to track your progress

## Commands

- /goal <objective>        - Set or replace the active goal
- /goal                    - Show the current goal
- /goal pause              - Pause the active goal (stops idle continuations)
- /goal resume             - Resume a paused goal
- /goal clear              - Clear the current goal

## Your Task

Parse the arguments below and set the goal. The format is:
\`<objective>\` or one of: pause, resume, clear`
