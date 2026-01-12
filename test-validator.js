// Test script to simulate agent-output-validator hook behavior
import { validateCommanderOutput } from "./src/shared/commander-validator";
import { validateOracleOutput } from "./src/shared/reviewer-validator";

console.log("=== Testing Agent Output Validator ===\n");

// Test 1: Valid Commander output
console.log("Test 1: Valid Commander output");
const validCommanderOutput = `
=== DECISION ===
Use React Context API for state management.

=== SYSTEM DIAGRAM ===
User → Component → Context → API

=== API / DATA MODEL ===
interface AppState {
  user: User;
  loading: boolean;
}

=== MILESTONES ===
1. Create Context
2. Create Provider
3. Implement hooks

=== ACCEPTANCE CRITERIA ===
AC1. Context is created
AC2. Provider wraps app
AC3. Custom hooks work

=== RISK & ROLLBACK ===
Risk: Performance
Rollback: Revert to props
`;

const commanderResult = validateCommanderOutput(validCommanderOutput);
console.log("✓ Valid Commander output validation:", commanderResult.isValid ? "PASS" : "FAIL");
if (!commanderResult.isValid) {
  console.log("  Errors:", commanderResult.errors.join(", "));
}
console.log();

// Test 2: Valid Oracle output
console.log("Test 2: Valid Oracle output");
const validOracleOutput = `
VERDICT: PASS

## CRITERIA CHECK

| # | Criteria | Status | Evidence |
|---|----------|--------|----------|
| 1 | No implementation code | ✓ PASS | No code blocks found |
| 2 | Structured format | ✓ PASS | Has VERDICT + CRITERIA table |
| 3 | No tool calls | ✓ PASS | No edit/write/bash suggested |
`;

const oracleResult = validateOracleOutput(validOracleOutput);
console.log("✓ Valid Oracle output validation:", oracleResult.isValid ? "PASS" : "FAIL");
if (!oracleResult.isValid) {
  console.log("  Errors:", oracleResult.errors.join(", "));
}
console.log();

// Test 3: Invalid Commander output (has implementation)
console.log("Test 3: Invalid Commander output (contains implementation code)");
const invalidCommanderOutput = `
Here's how to implement this:

\`\`\`typescript
const App = () => {
  return <div>Hello</div>;
}
\`\`\`
`;

const invalidCommanderResult = validateCommanderOutput(invalidCommanderOutput);
console.log("✗ Invalid Commander output validation:", invalidCommanderResult.isValid ? "PASS (WRONG!)" : "FAIL (CORRECT!)");
if (!invalidCommanderResult.isValid) {
  console.log("  Errors:", invalidCommanderResult.errors.join(", "));
}
console.log();

// Test 4: Invalid Oracle output (missing VERDICT)
console.log("Test 4: Invalid Oracle output (missing VERDICT)");
const invalidOracleOutput = `
This is just some output without proper format.
`;

const invalidOracleResult = validateOracleOutput(invalidOracleOutput);
console.log("✗ Invalid Oracle output validation:", invalidOracleResult.isValid ? "PASS (WRONG!)" : "FAIL (CORRECT!)");
if (!invalidOracleResult.isValid) {
  console.log("  Errors:", invalidOracleResult.errors.join(", "));
}
console.log();

console.log("=== All tests completed ===");
