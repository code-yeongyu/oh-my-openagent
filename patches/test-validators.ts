// Import from source files directly for testing
import { validateCommanderOutput, type CommanderValidationResult } from "../src/shared/commander-validator";
import { validateOracleOutput, type ReviewerValidationResult } from "../src/shared/reviewer-validator";

console.log("=== Import Test ===");
console.log("validateCommanderOutput type:", typeof validateCommanderOutput);
console.log("validateOracleOutput type:", typeof validateOracleOutput);
console.log();

console.log("=== Testing Commander Validator ===\n");

const validCommanderOutput = `
VERDICT: PASS

### SPEC
1. Implement user authentication
2. Add JWT token handling
3. Create login endpoint

### ACCEPTANCE CRITERIA
1. Users can login with valid credentials
2. Invalid credentials return 401
3. JWT tokens expire after 1 hour

### FILES/FUNCTIONS TO CHANGE
- src/auth/login.ts
- src/middleware/auth.ts

### TASKS FOR IMPLEMENTER
1. Create login function
2. Implement JWT generation
3. Add auth middleware
`;

const invalidCommanderOutput = `
### SPEC
1. Implement user authentication

### ACCEPTANCE CRITERIA
1. Users can login
`;

console.log("Test 1: Valid Commander Output");
const result1 = validateCommanderOutput(validCommanderOutput);
console.log("Valid:", result1.isValid);
console.log("Errors:", result1.errors);
console.log("Warnings:", result1.warnings);
console.log();

console.log("Test 2: Invalid Commander Output (missing VERDICT)");
const result2 = validateCommanderOutput(invalidCommanderOutput);
console.log("Valid:", result2.isValid);
console.log("Errors:", result2.errors);
console.log();

console.log("=== Testing Oracle Validator ===\n");

const validOracleOutput = `
VERDICT: PASS

CRITERIA CHECK:
| # | Criteria | Met | Notes |
|---|----------|-----|-------|
| 1 | Type Safety | Yes | No any types used |
| 2 | Error Handling | Yes | Proper try-catch |
| 3 | Code Patterns | Yes | Follows conventions |

RISK POINTS:
- None identified

MISSING TESTS:
- Add unit tests for login function
`;

const invalidOracleOutput = `
Review completed successfully.
`;

console.log("Test 3: Valid Oracle Output");
const result3 = validateOracleOutput(validOracleOutput);
console.log("Valid:", result3.isValid);
console.log("Errors:", result3.errors);
console.log();

console.log("Test 4: Invalid Oracle Output (missing VERDICT and CRITERIA)");
const result4 = validateOracleOutput(invalidOracleOutput);
console.log("Valid:", result4.isValid);
console.log("Errors:", result4.errors);
console.log();

console.log("=== Summary ===");
console.log("Commander Validator Tests:", result1.isValid && !result2.isValid ? "PASSED" : "FAILED");
console.log("Oracle Validator Tests:", result3.isValid && !result4.isValid ? "PASSED" : "FAILED");
