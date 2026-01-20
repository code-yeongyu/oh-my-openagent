# Ultrapower Mode Implementation Plan

## Overview
Add "ultrapower" keyword detection that triggers a structured development workflow using superpowers skills.

## Trigger Keywords
- `ulo` - short form
- `ultrapower` - full form
- Pattern: `/\b(ulo|ultrapower)\b/i`

## Mode Announcement
"ULTRAPOWER MODE ENABLED!"

## Two Operating Modes

### Planner Mode (agent name contains "planner", "plan", or "prometheus")
1. **Identity**: Planner, not implementer
2. **Workflow**:
   - Invoke `brainstorming` skill
   - Ask if user wants `using-git-worktrees` skill
   - Invoke `writing-plans` skill
   - Save plan to `docs/plans/YYYY-MM-DD-<feature>.md`
3. **End State**: Prompt user to run `/start-work` for execution

### Executor Mode (all other agents like Sisyphus)
1. **Identity**: Full-cycle executor
2. **Workflow**:
   - Invoke `brainstorming` skill
   - Ask if user wants `using-git-worktrees` skill
   - Invoke `writing-plans` skill
   - Auto-execute `subagent-driven-development` skill
   - Invoke `finishing-a-development-branch` skill
3. **End State**: Complete implementation with PR-ready state

## Files to Modify

### 1. `src/hooks/keyword-detector/detector.ts`
- Add `"ultrapower"` to `DetectedKeyword.type` union

### 2. `src/hooks/keyword-detector/constants.ts`
- Add `ULTRAPOWER_PLANNER_SECTION` constant
- Add `getUltrapowerMessage(agentName?)` function
- Add ultrapower entry to `KEYWORD_DETECTORS` array

### 3. `src/hooks/keyword-detector/index.ts`
- Add ultrapower toast notification logic
- Handle `ultrapower` type in detection flow

### 4. `src/hooks/keyword-detector/index.test.ts`
- Add ultrapower keyword detection tests
- Add planner vs executor mode tests

### 5. Local: `/Users/mac/.config/opencode/command/start-work.md`
- Create `/start-work` slash command for planner mode handoff

## Implementation Details

### `getUltrapowerMessage` Function
```typescript
export function getUltrapowerMessage(agentName?: string): string {
  const isPlanner = isPlannerAgent(agentName)
  
  if (isPlanner) {
    // Planner mode: brainstorming → git-worktree → writing-plans → prompt /start-work
  }
  
  // Executor mode: full workflow with subagent-driven-development
}
```

### KEYWORD_DETECTORS Entry
```typescript
{
  pattern: /\b(ulo|ultrapower)\b/i,
  message: getUltrapowerMessage,
}
```

### Toast Notification
```typescript
if (hasUltrapower) {
  ctx.client.tui.showToast({
    body: {
      title: "Ultrapower Mode Activated",
      message: "Superpowers workflow engaged.",
      variant: "success",
      duration: 3000,
    },
  })
}
```

## Test Cases
1. Ultrapower keyword detection (ulo, ultrapower)
2. Word boundary validation (no false positives)
3. Planner agent gets planner-specific message
4. Executor agent gets executor-specific message
5. Session filtering (same as ultrawork)
6. Agent switch scenarios

## PR Information
- Target: `code-yeongyu/oh-my-opencode` dev branch
- Title: `feat: add ultrapower mode with superpowers workflow integration`
