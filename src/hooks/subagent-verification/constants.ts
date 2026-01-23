/**
 * Subagent Verification Hook Constants
 *
 * Reminds orchestrator to verify subagent claims after delegation.
 * Also reminds to update planning files after task completion.
 * Implements Task 6.2 from SUBAGENTS-COMPARISON.md
 */

export const HOOK_NAME = "subagent-verification"

export const VERIFICATION_REMINDER = `⚠️ **SUBAGENT VERIFICATION REQUIRED**

The delegated task has completed. **SUBAGENTS LIE - NEVER trust their claims.**

You MUST verify independently:

1. **Run \`lsp_diagnostics\` at PROJECT level**:
   \`\`\`typescript
   lsp_diagnostics({ filePath: "src/" })
   \`\`\`

2. **Run build/test commands**:
   \`\`\`bash
   bun run build && bun test
   \`\`\`

3. **Read the actual changed files** - confirm changes match requirements

4. **Check for regressions** - related tests still pass

**Only proceed when ALL verifications pass. You are the QA gate.**

---

📝 **PLANNING FILES UPDATE REQUIRED**

After verification, update your planning files:

1. **tasks.md**: Check off completed task: \`- [x]\`
2. **findings.md**: Record any discoveries or issues from this task
3. **progress.md**: Log the action taken and any errors encountered`

export const DELEGATE_TASK_TOOL = "delegate_task"
