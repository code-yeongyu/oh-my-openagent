// Test Agent Output Validator Hook
import { createAgentOutputValidatorHook } from "../src/hooks/agent-output-validator/index";

console.log("=== Agent Output Validator Hook Test ===\n");

// Create mock context
const mockCtx = {
  directory: "/test",
  client: null as any,
} as any;

// Create hook
const hook = createAgentOutputValidatorHook(mockCtx);

console.log("Hook created:", typeof hook);
console.log("Hook has tool.execute.after:", "tool.execute.after" in hook);
console.log();

// Test 1: Valid Oracle Output
console.log("Test 1: Valid Oracle Output");
const validOracleOutput = {
  title: "Oracle Review",
  output: `
VERDICT: PASS

CRITERIA CHECK:
| # | Criteria | Met | Notes |
|---|----------|-----|-------|
| 1 | Type Safety | Yes | No any types used |
| 2 | Error Handling | Yes | Proper try-catch |

RISK POINTS:
- None identified
`,
  metadata: {},
};

const toolInput1 = {
  tool: "call_omo_agent",
  sessionID: "test-session-1",
  callID: "call-1",
};

await hook["tool.execute.after"](toolInput1, validOracleOutput as any);
console.log("Output after validation:", validOracleOutput.output.substring(0, 100) + "...");
console.log();

// Test 2: Invalid Oracle Output (missing VERDICT)
console.log("Test 2: Invalid Oracle Output (missing VERDICT)");
const invalidOracleOutput = {
  title: "Oracle Review",
  output: `
Review completed successfully.
The code looks good to me.
`,
  metadata: {},
};

await hook["tool.execute.after"](toolInput1, invalidOracleOutput as any);
console.log("Output after validation:", invalidOracleOutput.output.substring(0, 150) + "...");
console.log();

// Test 3: Oracle with implementation code
console.log("Test 3: Oracle with implementation code (VIOLATION)");
const oracleWithCode = {
  title: "Oracle Review",
  output: `
VERDICT: PASS

CRITERIA CHECK:
| # | Criteria | Met | Notes |
|---|----------|-----|-------|
| 1 | Type Safety | Yes | No any types used |

Here's the fix for the issue:

\`\`\`typescript
const fixedCode = (value: string) => {
  return value.trim();
};
\`\`\`

This implementation solves the problem.
`,
  metadata: {},
};

await hook["tool.execute.after"](toolInput1, oracleWithCode as any);
console.log("Output after validation:", oracleWithCode.output.substring(0, 200) + "...");
console.log();

// Test 4: Valid Commander Output
console.log("Test 4: Valid Commander Output");
const validCommanderOutput = {
  title: "Commander Spec",
  output: `
VERDICT: PASS

### SPEC
1. Implement user authentication
2. Add JWT token handling

### ACCEPTANCE CRITERIA
1. Users can login with valid credentials

### FILES/FUNCTIONS TO CHANGE
- src/auth/login.ts

### TASKS FOR IMPLEMENTER
1. Create login function
`,
  metadata: {},
};

await hook["tool.execute.after"](toolInput1, validCommanderOutput as any);
console.log("Output after validation:", validCommanderOutput.output.substring(0, 100) + "...");
console.log();

// Test 5: Commander with implementation code (VIOLATION)
console.log("Test 5: Commander with implementation code (VIOLATION)");
const commanderWithCode = {
  title: "Commander Spec",
  output: `
VERDICT: PASS

### SPEC
1. Implement user authentication

### ACCEPTANCE CRITERIA
1. Users can login

### FILES/FUNCTIONS TO CHANGE
- src/auth/login.ts

### TASKS FOR IMPLEMENTER
1. Here's how to implement the login:

\`\`\`typescript
export async function login(email: string, password: string) {
  const user = await authenticate(email, password);
  return user ? generateToken(user) : null;
}
\`\`\`

This is the complete implementation.
`,
  metadata: {},
};

await hook["tool.execute.after"](toolInput1, commanderWithCode as any);
console.log("Output after validation:", commanderWithCode.output.substring(0, 250) + "...");
console.log();

// Test 6: Non-agent tool (should be skipped)
console.log("Test 6: Non-agent tool (should be skipped)");
const grepOutput = {
  title: "Grep Results",
  output: `Found 3 matches...`,
  metadata: {},
};

const grepInput = {
  tool: "grep",
  sessionID: "test-session-1",
  callID: "call-2",
};

await hook["tool.execute.after"](grepInput, grepOutput as any);
console.log("Output (should be unchanged):", grepOutput.output);
console.log();

console.log("=== All Tests Complete ===");
