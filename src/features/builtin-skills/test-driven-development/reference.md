# Reference: test-driven-development

## Best Practices

- Prefer fast, deterministic tests; mock external calls
- Cover edge cases and error handling, not just happy paths
- Guardrails: reject empty tests, missing assertions, trivial assertions
- Pair with `verification-before-completion` before marking tasks done

## Test Naming Convention

```typescript
// Format: should_[expected]_when_[condition]
describe('UserAuth', () => {
  it('should_return_token_when_credentials_valid', () => {})
  it('should_throw_error_when_password_incorrect', () => {})
  it('should_lock_account_when_attempts_exceed_limit', () => {})
})
```

## Common Pitfalls

❌ **Testing implementation**: Test behavior, not internal details
❌ **Insufficient coverage**: Happy path only, no edge cases
❌ **Flaky tests**: Depending on timing, network, or order
❌ **Over-mocking**: Mocking so much the test is meaningless

## AST Quality Checks

The system performs static analysis to detect:

1. **Empty bodies**: Test functions with no statements
2. **Missing assertions**: No `expect`, `assert`, `should` calls
3. **Trivial assertions**: `expect(true).toBe(true)`, `assert True`

## TDD with Codex

1. Write test specification (describe expected behavior)
2. Ask Codex to generate test code
3. Verify test fails correctly
4. Ask Codex for implementation prototype
5. Refine and integrate implementation
6. Request Codex review

```typescript
// Step 1: Generate test
mcp_codex_codex({
  PROMPT: "为以下功能生成单元测试:\n\n{specification}",
  cd: "{project}",
  sandbox: "read-only"
})

// Step 2: Generate implementation
mcp_codex_codex({
  PROMPT: "实现以下函数使测试通过:\n\n{test_code}",
  cd: "{project}",
  sandbox: "read-only"
})
```
