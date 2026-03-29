---
name: typescript-worker
description: TypeScript feature implementation worker for oh-my-opencode
---

# TypeScript Worker

Implementation worker for TypeScript features in oh-my-opencode plugin.

## When to Use This Skill

Use for implementing TypeScript features that involve:
- Schema modifications (Zod v4)
- MCP configuration updates
- Config option additions

## Work Procedure

### 1. Pre-Implementation
- Read AGENTS.md for project conventions
- Read relevant existing code to understand patterns
- Understand the feature requirements from mission.md and feature description

### 2. Schema Changes (if applicable)
- Add new types/schemas following existing patterns
- Use Zod v4 for validation
- Export types alongside schemas
- Add JSDoc comments for config options

### 3. Implementation
- Modify source files to implement the feature
- Follow existing code patterns and conventions
- Maintain backward compatibility where required

### 4. Testing
- Run `bun run typecheck` - must pass with no errors
- Run `bun test` - all tests must pass
- If tests fail, investigate and fix (or note if pre-existing)

### 5. Verification
- Verify the implementation matches requirements
- Check for any edge cases
- Ensure backward compatibility is maintained

## Example Handoff

```json
{
  "salientSummary": "Added exa_tools config option to websearch schema and updated MCP URL builder to support configurable tool selection. All type checks and tests pass.",
  "whatWasImplemented": "Modified src/config/schema/websearch.ts to add ExaToolSchema enum with 8 tools and exa_tools union field (string[] | 'all' | 'default'). Modified src/mcp/websearch.ts to build URL with selected tools, supporting presets ('all', 'default') and custom arrays. Default behavior unchanged for backward compatibility.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "No TypeScript errors"
      },
      {
        "command": "bun test",
        "exitCode": 0,
        "observation": "All tests passing"
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [],
    "modified": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Requirements are unclear or ambiguous
- Existing code patterns cannot be followed
- Tests fail in ways that suggest deeper issues
- Type check errors indicate architectural problems
