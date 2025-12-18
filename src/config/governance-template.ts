import type { GovernanceLevel } from "../agents/types"

/**
 * Centralized governance template for agent prompt injection.
 * Injected into agents with governanceLevel: "full" or "minimal".
 *
 * Token budget: ~400-500 tokens (within NFR-001 limit of 500)
 *
 * @see .cursor/specs/LIF-62-feat-multi-layered-orchestration/plan.md
 */

/**
 * Full governance template for file-modifying agents.
 * Includes all governance rules: path validation, changelog, Linear, spec workflow.
 *
 * Used when governanceLevel: "full"
 */
export const GOVERNANCE_TEMPLATE_FULL = `
<governance>
## Governance Awareness

You are operating within a governed environment. These rules are MANDATORY.

### Path Discipline
File operations MUST follow these conventions:
- **Spec files**: \`.cursor/specs/{ISSUE-ID}-{type}-{name}/\` or \`context/specs/\`
- **Source code**: \`src/\`, \`tests/\`, \`docs/\`
- **Memory files**: \`.cursor/memory/\`
- **Config files**: Project root only for standard configs

⚠️ The governance-path-validator hook will WARN or BLOCK writes to non-standard paths.

### Changelog Discipline
Your file modifications are automatically tracked by the governance-historian hook:
- Changelog entries are created at session end
- Include meaningful descriptions in your work
- Files created/modified are logged automatically

### Linear Integration
When Linear issue IDs are detected (e.g., LIF-123):
- Linear context is automatically injected by governance-linear-injector
- Use \`linear_branch\` tool to get correct branch names
- Use \`linear_update_status\` tool when completing work
- Reference issue IDs in commit messages

### Spec-Driven Workflow
For features >4h of work:
- Check for existing spec folder: \`glob(".cursor/specs/{ISSUE-ID}-*")\`
- Use \`create_spec_folder\` tool for new features
- Read \`tasks.md\` for task breakdown
- Update \`status.md\` with progress

### Structured Response Format
When completing delegated work, return structured results:
\`\`\`json
{
  "status": "success|partial|failed",
  "summary": "Brief description of work completed",
  "files": {
    "created": ["path/to/new/file.ts"],
    "modified": ["path/to/changed/file.ts"]
  },
  "errors": ["Optional: any errors encountered"],
  "nextSteps": ["Optional: recommended follow-up actions"],
  "knowledge": ["Optional: any knowledge gained" that will be useful for the next agent"]
}
\`\`\`
</governance>
`

/**
 * Minimal governance template for agents that need basic awareness.
 * Includes only path validation and changelog tracking.
 *
 * Used when governanceLevel: "minimal"
 */
export const GOVERNANCE_TEMPLATE_MINIMAL = `
<governance>
## Governance Awareness

### Path Discipline
- Source code → \`src/\`, \`tests/\`, \`docs/\`
- Spec files → \`.cursor/specs/\`

### Changelog
Your file modifications are tracked automatically.
</governance>
`

/**
 * Get governance template based on level.
 *
 * @param level - The governance level to get template for
 * @returns The governance template string, or empty string for "none"
 */
export function getGovernanceTemplate(level: GovernanceLevel): string {
  switch (level) {
    case "full":
      return GOVERNANCE_TEMPLATE_FULL
    case "minimal":
      return GOVERNANCE_TEMPLATE_MINIMAL
    case "none":
      return ""
  }
}
