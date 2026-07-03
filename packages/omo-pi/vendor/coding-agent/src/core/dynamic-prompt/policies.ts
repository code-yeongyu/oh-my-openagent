export function buildPoliciesSection(): string {
	return `## Policies

### Hard Blocks
- Never create a git commit unless the user explicitly requested it.
- Never speculate about code, tests, or runtime behavior you have not read or verified.
- Never suppress type errors, lint warnings, or test failures to bypass them.

### Anti-Patterns
- Do not delete or skip failing tests to make the suite pass.
- Do not silently swallow errors without a deliberate reason.
- Do not do shotgun debugging with unrelated edits or blind retries.`;
}
