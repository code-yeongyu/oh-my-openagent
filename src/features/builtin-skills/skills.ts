import type { BuiltinSkill } from "./types";

const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description:
    "Browser automation with Playwright MCP. Use for web scraping, testing, screenshots, and browser interactions.",
  template: `# Playwright Browser Automation

This skill provides browser automation capabilities via the Playwright MCP server.`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
};

const continuityLedgerSkill: BuiltinSkill = {
  name: "continuity_ledger",
  description:
    "Create or update a continuity ledger to preserve session state across /clear operations.",
  template: `# Continuity Ledger Management

You are managing a continuity ledger - a structured document that preserves session state across context clears.

## Task
Create or update the ledger file at \`thoughts/ledgers/CONTINUITY_CLAUDE-{session-name}.md\`

## Ledger Structure
The ledger MUST follow this exact format:

\`\`\`markdown
# Session: {session-name}
Updated: {ISO timestamp}

## Goal
{Clear success criteria for the current task}

## Constraints
- {Technical requirements}
- {Patterns to follow}
- {Limitations to respect}

## Key Decisions
- {Decision}: {Rationale}

## State
- Done: {completed items, comma-separated}
- Now: {current focus - single item}
- Next: {queued items, comma-separated}

## Open Questions
- UNCONFIRMED: {Things needing user verification}

## Working Set
- Branch: \`{branch-name}\`
- Key files: \`file1.ts\`, \`file2.ts\`
- Test cmd: \`{test command}\`
- Build cmd: \`{build command}\`
\`\`\`

## Instructions
1. If no ledger exists, create one with the current session state
2. If ledger exists, UPDATE it with current progress
3. Mark anything uncertain as "UNCONFIRMED" in Open Questions
4. Keep State.Now focused on ONE thing
5. Prune Done list to recent items (last 5-10)

## Critical Rules
- NEVER fabricate progress - only record what actually happened
- ALWAYS mark assumptions as UNCONFIRMED
- Keep the ledger concise - it must fit in context after /clear`,
};

const createHandoffSkill: BuiltinSkill = {
  name: "create_handoff",
  description:
    "Create a detailed handoff document before clearing context, preserving all critical information.",
  template: `# Create Handoff Document

You are creating a handoff document to preserve context before a /clear operation.

## Task
Create a handoff file at \`thoughts/shared/handoffs/{session-name}/handoff-{timestamp}.md\`

## Handoff Structure

\`\`\`markdown
---
date: {ISO timestamp}
type: manual-handoff
context_percentage: {current context usage}%
---

# Handoff: {brief description}

## Current State
**Goal:** {What we're trying to achieve}
**Progress:** {What's been completed}
**Current Focus:** {What we're working on now}

## Key Decisions Made
1. {Decision with rationale}
2. {Decision with rationale}

## Open Issues
- [ ] {Issue that needs resolution}
- [ ] {Blocker or uncertainty}

## Files Modified
- \`path/to/file.ts\` - {what was changed}

## Next Steps (Priority Order)
1. {Immediate next action}
2. {Following action}
3. {Then this}

## Context to Preserve
{Any critical context that would be lost - error messages, user preferences, etc.}

## Recovery Instructions
After /clear, run: \`/resume_handoff\` to load this context.
\`\`\`

## Instructions
1. Analyze current conversation for all critical state
2. Identify decisions, progress, and blockers
3. List files that have been modified
4. Prioritize next steps clearly
5. Include any context that would be costly to rediscover

## Critical Rules
- Be thorough but concise
- Prioritize actionable information
- Don't include conversation noise, focus on signal
- Make it easy for a fresh context to continue seamlessly`,
};

const resumeHandoffSkill: BuiltinSkill = {
  name: "resume_handoff",
  description:
    "Load the most recent handoff document to restore context after a /clear operation.",
  template: `# Resume from Handoff

You are restoring context from a handoff document after a /clear operation.

## Task
1. Find the most recent handoff in \`thoughts/shared/handoffs/\`
2. Load and parse the handoff content
3. Summarize the restored context to the user
4. Identify immediate next steps

## Process

### Step 1: Locate Handoff
Search for the most recent handoff file:
- Check \`thoughts/shared/handoffs/*/\` directories
- Sort by modification time
- Select the newest handoff-*.md file

### Step 2: Parse and Validate
Read the handoff and extract:
- Goal and current state
- Key decisions (verify they still apply)
- Open issues (check if any resolved)
- Next steps

### Step 3: Report to User
Present a concise summary:

\`\`\`
📋 **Handoff Restored**

**Goal:** {goal from handoff}
**Last Progress:** {what was completed}
**Current Focus:** {where we left off}

**Open Issues:**
{list any blockers}

**Recommended Next Step:** {priority 1 from next steps}

---
*Loaded from: {handoff file path}*
*Created: {handoff date}*
\`\`\`

### Step 4: Verify with User
Ask the user to confirm:
- Is this the correct context to resume?
- Have any circumstances changed?
- Should we proceed with the recommended next step?

## Critical Rules
- ALWAYS verify understanding with user before proceeding
- Note any UNCONFIRMED items from the original session
- Don't assume - if something seems stale, ask
- If no handoff found, check for ledger instead`,
};

export function createBuiltinSkills(): BuiltinSkill[] {
  return [
    playwrightSkill,
    continuityLedgerSkill,
    createHandoffSkill,
    resumeHandoffSkill,
  ];
}
