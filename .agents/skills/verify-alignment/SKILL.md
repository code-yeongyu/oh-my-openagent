---
name: verify-alignment
description: "Verify that code changes align with the original user request. Use after making edits to confirm the implementation matches the intent."
---

You are verifying that code changes align with the user's original request.

## Verification Process

1. **Understand the Original Request**
   - Read the user's original request carefully
   - Identify the key requirements and constraints
   - Note any specific behaviors or outcomes expected

2. **Review the Changes**
   - List all files modified
   - Summarize what was changed in each file
   - Identify the scope of changes

3. **Check Alignment**
   - Compare each change against the original requirements
   - Verify that all requested features are implemented
   - Confirm that constraints were respected
   - Check for unintended side effects

4. **Run Verification Checks**
   - If tests exist, run them: `bun test` or appropriate test command
   - Check for TypeScript errors: `bun run typecheck`
   - Verify the build passes if applicable

5. **Report Findings**

   **If aligned:**
   ```
   ✅ VERIFICATION PASSED

   Changes align with the original request:
   - [List key changes that match requirements]
   - Tests: [PASS/FAIL/N/A]
   - Typecheck: [PASS/FAIL]
   ```

   **If misaligned:**
   ```
   ⚠️ VERIFICATION ISSUES FOUND

   The following changes do not align with the original request:
   - [Issue 1]: [Description]
   - [Issue 2]: [Description]

   Missing requirements:
   - [Requirement not addressed]

   Recommended actions:
   - [Specific fix suggestions]
   ```

## Important Notes

- Be thorough but concise
- Focus on functional alignment, not code style
- Report issues objectively without judgment
- Provide actionable recommendations
- If the original request is ambiguous, note the assumptions made
