\n### CLI Install Flow Patterns - 2026年01月29日  1:36:10
- **Step Pattern**: Uses `printStep(step++, totalSteps, "message")` located in `src/cli/install.ts`.
- **Spinner**: Utilizes `@clack/prompts` spinner via `const s = p.spinner()`.
- **Total Steps**: `totalSteps` is a hardcoded constant that must be updated when adding new steps.
- **Non-blocking failures**: Observed in MCP installation step (Step 7) where errors are caught to prevent full install failure.
- **Relevant File**: `/C:/github/oh-my-opencode-update/src/cli/install.ts`

## [2026-01-29 01:25] bun:test Module Mocking for 'fs'

### Best Practices
- **Use `mock.module()`**: This is the primary API for mocking modules (ESM, CJS, and Built-ins) in Bun.
- **Prefix Consistency**: Mock both `node:fs` and `fs` if the codebase uses both, or stick to the one used in the source.
- **Mock Functionality**: Use `mock(() => ...)` for individual functions within the mocked module to enable call tracking (e.g., `toHaveBeenCalled()`).
- **Cleanup**: Use `mock.restore()` to clear all mocks between tests if they are defined inside `describe` or `test` blocks.

### Example Snippet
```typescript
import { test, expect, mock } from "bun:test";

// Mocking 'node:fs' module
mock.module("node:fs", () => {
  return {
    readFileSync: mock((path: string) => {
      if (path === "config.json") return '{"mocked": true}';
      throw new Error("File not found");
    }),
    existsSync: mock(() => true),
    mkdirSync: mock(),
    writeFileSync: mock(),
  };
});

// Import the module AFTER (or before, Bun hoists mock.module)
import fs from "node:fs";

test("observation-recorder uses mocked fs", () => {
  const data = fs.readFileSync("config.json");
  expect(data).toBe('{"mocked": true}');
  expect(fs.readFileSync).toHaveBeenCalledWith("config.json");
});
```

### Gotchas & Observations
- **Hoisting**: Bun hoists `mock.module` calls to the top of the file, meaning it will affect imports regardless of where it's placed in the script.
- **Dynamic Mocks**: If you need different mock implementations per test, define the mock once with `mock()` and use `mockImplementation()` or `mockReturnValue()` inside the test.
- **Core Modules**: Unlike some other runners, Bun's `mock.module` handles Node.js built-ins natively without additional configuration.
- **Resetting**: To remove a module mock entirely, you can use `mock.module("specifier", null)`.

**Source**: [Bun Documentation - Mocks](https://bun.sh/docs/test/mocks)
