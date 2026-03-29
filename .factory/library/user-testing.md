# User Testing

Testing surface and setup for manual verification.

## Commands

- `bun run typecheck` - TypeScript type checking
- `bun test` - Run test suite
- `bun run build` - Build the plugin

## Testing Approach

This mission involves schema and MCP config changes:

1. **Type checking**: Ensure schema changes are type-safe
2. **Unit tests**: Run existing tests for regression detection
3. **Code review**: Manual verification of URL construction logic

## Validation

Validation contract assertions cover:
- Schema correctness (enum definition, union types)
- MCP URL building (presets, custom arrays, defaults)
- Code quality (typecheck, tests)
