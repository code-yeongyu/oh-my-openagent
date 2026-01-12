// Test Agent Output Validator Hook (with debug)
import { createAgentOutputValidatorHook } from "../src/hooks/agent-output-validator/index";

console.log("=== Agent Output Validator Hook Test ===\n");

// Create mock context
const mockCtx = {
  directory: "/test",
  client: null as any,
} as any;

// Create hook
const hook = createAgentOutputValidatorHook(mockCtx);

console.log("1. Hook created:", typeof hook);
console.log("2. Hook has tool.execute.after:", "tool.execute.after" in hook);
console.log();

// Test 3: Oracle with implementation code (VIOLATION)
console.log("Test 3: Oracle with implementation code");
const oracleWithCode = {
  title: "Oracle Review",
  output: `
VERDICT: PASS

CRITERIA CHECK:
| # | Criteria | Met | Notes |
|---|----------|-----|-------|
| 1 | Type Safety | Yes | No any types used |

Here's the fix:

\`\`\`typescript
const fixedCode = (value: string) => {
  return value.trim();
};
\`\`\`

This is the complete implementation.
`,
  metadata: {},
};

const toolInput = {
  tool: "call_omo_agent",
  sessionID: "test-session-1",
  callID: "call-1",
};

const originalOutput = oracleWithCode.output;

await hook["tool.execute.after"](toolInput, oracleWithCode as any);

console.log("Original output length:", originalOutput.length);
console.log("Modified output length:", oracleWithCode.output.length);
console.log("Output was modified:", oracleWithCode.output !== originalOutput);
console.log();
console.log("Modified output (last 500 chars):");
console.log(oracleWithCode.output.slice(-500));
console.log();
