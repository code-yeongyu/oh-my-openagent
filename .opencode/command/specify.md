---
description: Create or update the feature specification from a natural language feature description.
step: specify
requires: []
produces:
  - spec.md
next: plan
linear_status: todo
category: workflow
primary: true
handoffs: 
  - label: Build Technical Plan
    agent: plan
    prompt: Create a plan for the spec. I am building with...
  - label: Clarify Spec Requirements
    agent: clarify
    prompt: Clarify specification requirements
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The text the user typed after `/specify` in the triggering message **is** the feature description. Assume you always have it available in this conversation even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Linear-First Requirement (MANDATORY)**:
   - **If Linear MCP is available**: 
     - **MUST** create or select a placeholder parent Linear issue BEFORE proceeding
     - Search for existing Linear issues matching the description using `mcp_Linear_list_issues`
     - If issue found: Use `issue.branchName` and issue ID for folder naming
     - If issue has parent: Prompt user: "Use parent feature branch" vs "Standalone on child issue branch"
     - **If no issue found**: 
       - Propose creating a minimal placeholder parent issue
       - **REQUIRE user confirmation** - if user declines, **REFUSE to proceed** (stop execution)
       - Placeholder issue should have:
         - Clear title (enough to identify feature)
         - Short summary (1-2 sentences)
         - Correct type label (`type:feature`, `type:bug`, etc.)
         - Appropriate team assignment
     - **CRITICAL**: No spec folder or artifacts can be created without a Linear issue existing first
   - **If Linear MCP is NOT available**: 
     - Fall back to non-Linear mode (sequential numbering: `{NNN}-{type}-{slug}`)
     - Only allowed when Linear MCP is unavailable (offline mode)

2. **Call create-feature.sh script**:
   - **Linear Mode** (when Linear MCP available and issue created/selected):
     ```bash
     .cursor/scripts/bash/create-feature.sh --json \
       --branch-name "{issue.branchName}" \
       --spec-dir-name "{ISSUE-ID}-{type}-{name-slug}" \
       --issue-id "{ISSUE-ID}" \
       --issue-type "{type}" \
       "$ARGUMENTS"
     ```
     - **MUST** have Linear issue before calling script (from step 1)
   - **Non-Linear Mode** (ONLY when Linear MCP unavailable - offline fallback):
     ```bash
     .cursor/scripts/bash/create-feature.sh --json "$ARGUMENTS" --short-name "{generated-short-name}"
     ```
     - **ONLY** allowed when Linear MCP is not available
     - Sequential numbering: `{NNN}-{type}-{slug}` format
   - Parse JSON output to get `BRANCH_NAME`, `SPEC_DIR`, `SPEC_FILE`, etc.

3. **Call Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path: `SPEC_DIR` from script output
   - Ensure path follows `.cursor/specs/{SPEC_DIR_NAME}/` structure

4. **Load spec template**:
   - Load `.cursor/templates/spec-template.md` to understand required sections

5. **Engage Product Strategist Agent**:
   - Read `.opencode/agent/product-strategist.md` (COMPLETE, no offset/limit)
   - Adopt Product Strategist persona
   - Create `spec.md` at `SPEC_FILE` path (from script JSON output)
   - **DO NOT re-create spec folder** - use `SPEC_DIR` from script
   - Follow Product Strategist steps exactly
   - **NOTE**: Product Strategist will also create Mintlify docs in `docs/requirements/` (dual workflow)

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for Product Strategist work
   - Include: mode, scope, files created, decisions made

7. **Report completion**:
   - Branch name, spec file path, readiness for next phase (`/plan` or `/clarify`)

8. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "specify",
     linearStatus: "todo"
   })
   ```
   This enables session continuity and resume messages.

## Linear Branch Policy

**CRITICAL**: When Linear is used:
- Git branch MUST be `issue.branchName` from Linear (exact match)
- Spec folder MUST be `{ISSUE-ID}-{type}-{name-slug}` format
- If issue has parent, prompt user for branch strategy (see step 1)

## Agent Integration

When Product Strategist agent is invoked:
- **DO NOT** create spec folder (already created by script)
- **USE** `SPEC_DIR` from script JSON output
- **RESPECT** provided canonical path
- **CALL** Context Steward before writing files
- **CALL** Historian after completing work
- **SUPPORT** dual workflow: Creates both `.cursor/specs/` and `docs/requirements/`

## General Guidelines

- Focus on **WHAT** users need and **WHY**
- Avoid HOW to implement (no tech stack, APIs, code structure)
- Written for business stakeholders, not developers
- DO NOT create checklists embedded in spec (use `/checklist` command)

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns
2. **Document assumptions**: Record reasonable defaults in Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist

## Success Criteria Guidelines

Success criteria must be:
1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:
- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"

**Bad examples** (implementation-focused):
- "API response time is under 200ms" (too technical)
- "Database can handle 1000 TPS" (implementation detail)
- "React components render efficiently" (framework-specific)
