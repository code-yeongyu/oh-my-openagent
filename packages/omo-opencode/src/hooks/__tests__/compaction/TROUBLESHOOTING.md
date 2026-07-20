# Troubleshooting Guide

## Common Test Failures and Solutions

### 1. Module Resolution Errors

#### Error: Cannot find module 'opencode/session/todo'

**Symptom:**
```
error: Cannot find module 'opencode/session/todo'
```

**Cause:** Bun's module mocking requires the module to exist or be properly mocked.

**Solution:**
```typescript
// Ensure mock is set up before imports
mock.module("opencode/session/todo", () => ({
  Todo: {
    update: async () => {},
  },
}))

// Then import the module under test
import { createCompactionTodoPreserverHook } from "../../compaction-todo-preserver"
```

**Prevention:**
- Always set up mocks before imports
- Use `mock.module()` at the top of test files
- Call `mock.restore()` in `afterEach()`

---

### 2. Mock Not Being Called

#### Error: Expected mock to be called, but wasn't

**Symptom:**
```
Expected summarizeMock to be called at least once
Received: 0 calls
```

**Cause:** 
- Mock not properly injected
- Test setup incomplete
- Condition not met

**Solution:**
```typescript
// 1. Verify mock is passed to the function
const mockClient = {
  session: {
    summarize: summarizeMock, // Ensure mock is assigned
  },
}

// 2. Verify test conditions
tokenCache.set(sessionID, createCachedState("anthropic", "claude-3-5-sonnet", 156000))

// 3. Clear mock before test
summarizeMock.mockClear()
```

**Debug Steps:**
1. Add `console.log` to verify mock is called
2. Check if conditions are met (threshold, cooldown, etc.)
3. Verify mock is properly injected into the system under test

---

### 3. Timeout Errors

#### Error: Test timed out after 5000ms

**Symptom:**
```
Test timed out after 5000ms
```

**Cause:**
- Async operation not completing
- Deadlock in test
- Slow CI runner

**Solution:**
```typescript
// Option 1: Increase timeout for specific test
it("long running test", async () => {
  // test code
}, 30000) // 30 seconds

// Option 2: Mock time-dependent operations
mock.module("../../shared/timing", () => ({
  setTimeout: (fn: Function) => fn(), // Execute immediately
}))

// Option 3: Skip timing tests in CI
const isCI = process.env.CI === "true"
const testFn = isCI ? it.skip : it

testFn("timeout-sensitive test", async () => {
  // test code
})
```

**Prevention:**
- Use generous timeouts (2x expected duration)
- Mock time where possible
- Skip timing tests in CI if flaky

---

### 4. Flaky Tests

#### Error: Test passes locally but fails in CI

**Symptom:**
```
✓ test passes locally
✗ test fails in CI (intermittently)
```

**Cause:**
- Race conditions
- Timing dependencies
- Resource contention

**Solution:**
```typescript
// 1. Add explicit waits
await new Promise((resolve) => setTimeout(resolve, 100))

// 2. Use retry logic
import { retry } from "./test-utils"

await retry(async () => {
  expect(result).toBe(expected)
}, { maxAttempts: 3, delay: 100 })

// 3. Isolate test state
beforeEach(() => {
  // Reset all state
  mockClient = createMockSessionClient()
  tokenCache.clear()
})
```

**Prevention:**
- Avoid timing dependencies
- Use explicit synchronization
- Run tests in isolation
- Increase timeouts for CI

---

### 5. Memory Errors

#### Error: JavaScript heap out of memory

**Symptom:**
```
FATAL ERROR: Reached heap limit Allocation failed
```

**Cause:**
- Large test data
- Memory leaks
- Too many concurrent tests

**Solution:**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
bun test

# Or reduce test data size
const facts = createTestFacts(50) // Instead of 100
```

**Prevention:**
- Clean up resources in `afterEach()`
- Use smaller test data sets
- Run tests sequentially, not in parallel

---

### 6. Assertion Failures

#### Error: Expected X but received Y

**Symptom:**
```
Expected: 78
Received: 77.5
```

**Cause:**
- Floating point precision
- Off-by-one errors
- Incorrect test expectations

**Solution:**
```typescript
// Use approximate matching for floating point
expect(accuracy).toBeCloseTo(78, 0) // Within 1

// Or use range checks
expect(accuracy).toBeGreaterThan(75)
expect(accuracy).toBeLessThan(80)

// Verify test data
console.log("Actual value:", accuracy)
```

**Prevention:**
- Use `toBeCloseTo()` for floating point
- Add debug logging
- Verify test data setup

---

### 7. Mock Restore Issues

#### Error: Mock still active after test

**Symptom:**
```
Test A passes
Test B fails because Test A's mock is still active
```

**Cause:**
- `mock.restore()` not called
- Mock leaking between tests

**Solution:**
```typescript
afterEach(() => {
  mock.restore() // Always restore mocks
})

// Or use mock isolation
describe("test suite", () => {
  beforeEach(() => {
    mock.module("module", () => ({
      // Fresh mock for each test
    }))
  })
})
```

**Prevention:**
- Always call `mock.restore()` in `afterEach()`
- Use `beforeEach()` to reset mocks
- Avoid global mock state

---

### 8. Type Errors

#### Error: Type 'X' is not assignable to type 'Y'

**Symptom:**
```
Type 'Mock<any>' is not assignable to type '() => Promise<void>'
```

**Cause:**
- Mock type doesn't match expected type
- Missing type annotations

**Solution:**
```typescript
// Add explicit type annotations
const summarizeMock = mock(async () => ({})) as ReturnType<typeof mock>

// Or use type assertion
const mockClient = {
  session: {
    summarize: summarizeMock as any,
  },
}

// Or create properly typed mock
function createMockSummarize() {
  return mock(async (input: any) => ({}))
}
```

**Prevention:**
- Use TypeScript strict mode
- Add type annotations to mocks
- Create typed mock factories

---

### 9. Coverage Report Issues

#### Error: Coverage below threshold

**Symptom:**
```
Coverage check failed: 75% < 80%
```

**Cause:**
- Missing test cases
- Untested edge cases
- Dead code

**Solution:**
```bash
# Generate detailed coverage report
bun test --coverage --coverage-reporter=text

# Identify uncovered lines
# Add tests for uncovered branches
```

**Prevention:**
- Run coverage locally before committing
- Add tests for all branches
- Remove dead code

---

### 10. CI/CD Pipeline Failures

#### Error: Tests pass locally but fail in CI

**Symptom:**
```
✓ Local: All tests pass
✗ CI: 3 tests fail
```

**Cause:**
- Different environment
- Missing dependencies
- Timing issues

**Solution:**
```yaml
# .github/workflows/test.yml
- name: Run tests
  run: |
    bun install --frozen-lockfile
    bun test --timeout=60000
  env:
    CI: true
    NODE_OPTIONS: --max-old-space-size=4096
```

**Prevention:**
- Match CI environment to local
- Use lockfiles
- Increase timeouts for CI
- Run CI tests locally first

---

## Debugging Techniques

### 1. Verbose Logging

```typescript
it("debug test", async () => {
  console.log("Setup:", { tokenCache, sessionID })
  
  const result = await runPreemptiveCompactionIfNeeded({ ... })
  
  console.log("Result:", result)
  console.log("Mock calls:", summarizeMock.mock.calls)
  
  expect(result).toBe(expected)
})
```

### 2. Isolate failing test

```bash
# Run single test
bun test -t "threshold trigger test"

# Run single file
bun test preemptive-compaction-trigger.test.ts
```

### 3. Use debugger

```typescript
it("debug test", async () => {
  debugger // Pause execution
  const result = await runPreemptiveCompactionIfNeeded({ ... })
  expect(result).toBe(expected)
})
```

Then run with:
```bash
bun test --inspect-brk
```

### 4. Snapshot testing

```typescript
it("snapshot test", () => {
  const result = formatForCompaction(entries)
  expect(result).toMatchSnapshot()
})
```

Update snapshots:
```bash
bun test --update-snapshots
```

---

## Performance Issues

### Slow Test Execution

**Symptom:** Tests take > 60 seconds

**Solution:**
```bash
# Run tests in parallel
bun test --parallel

# Skip slow tests
bun test --test-name-pattern="^(?!.*stress)"

# Run only fast tests
bun test --test-name-pattern="unit"
```

### High Memory Usage

**Symptom:** Tests use > 500MB memory

**Solution:**
```typescript
// Clean up after each test
afterEach(() => {
  mockClient = null
  tokenCache.clear()
  gc() // Force garbage collection if available
})

// Use smaller test data
const facts = createTestFacts(20) // Instead of 100
```

---

## Getting Help

### Internal Resources

- **Test Execution Guide**: [README.md](./README.md)
- **Coverage Report**: [COVERAGE.md](./COVERAGE.md)
- **OpenSpec Proposal**: `openspec/changes/compaction-mechanism-testing/proposal.md`

### External Resources

- **Bun Test Documentation**: https://bun.sh/docs/test
- **Bun Mocking**: https://bun.sh/docs/test/mocks
- **OpenCode Documentation**: https://docs.opencode.ai

### Contact

- **GitHub Issues**: Report bugs in the test suite
- **Discord**: #testing channel
- **Email**: testing@opencode.ai

---

## Checklist for Test Failures

When a test fails, follow this checklist:

- [ ] Read the error message carefully
- [ ] Check if mock is properly set up
- [ ] Verify test data is correct
- [ ] Run test in isolation
- [ ] Add debug logging
- [ ] Check for timing issues
- [ ] Verify environment matches CI
- [ ] Check for recent code changes
- [ ] Review test documentation
- [ ] Ask for help if stuck > 30 minutes
