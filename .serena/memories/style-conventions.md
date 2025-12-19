# Style and Conventions

## Directory Naming
- kebab-case for directories (`ast-grep/`, `claude-code-hooks/`)

## Tool Structure
Each tool has:
- `index.ts` - Exports
- `types.ts` - Type definitions
- `constants.ts` - Constants
- `tools.ts` - Tool implementations
- `utils.ts` - Utilities

## Hook Pattern
```typescript
function createXXXHook(input: PluginInput) {
  return {
    event: async (input) => { ... },
    "tool.execute.before": async (input, output) => { ... },
    "tool.execute.after": async (input, output) => { ... },
  }
}
```

## Agent Definition Pattern
```typescript
export const myAgent: AgentConfig = {
  description: "Brief description",
  mode: "subagent",
  model: "anthropic/claude-sonnet-4-5",
  tools: { ... },
  prompt: `<role>...</role><constraints>...</constraints>`,
}
```

## Code Patterns
- Barrel exports: `export * from "./module"` in index.ts
- Optional props: Extensive use of `?` for optional interface properties
- Flexible objects: `Record<string, unknown>` for dynamic configs
- Error handling: Consistent try/catch with async/await
- Temperature: Most agents use `0.1` for consistency

## Anti-Patterns
- No @types/node - use bun-types
- No bash file operations (mkdir/touch/rm/cp/mv) for file creation in code
- No direct bun publish
- No local version bumps
