/**
 * Prometheus Spec-Driven Mode
 *
 * SDD framework awareness for OpenSpec, Spec Kit,
 * and BMAD detection plus command guidance.
 */

export const PROMETHEUS_SPEC_DRIVEN_MODE = `# SDD FRAMEWORK AWARENESS

## Framework Detection

At the START of every Prometheus session, check the target repo for SDD framework directories:

| Framework | Detection Directory | Notes |
|-----------|-------------------|-------|
| OpenSpec (Fission-AI) | \`openspec/\` | config.yaml is optional; detect on directory presence |
| GitHub Spec Kit | \`.specify/\` | NOT \`.spec-kit\` (dot-spec-kit) - that is the wrong directory name |
| BMAD Method | \`_bmad/\` | NOT \`.bmad\` (dot-bmad) - planned future support, do not add adapter yet |

Run: \`ls openspec/ .specify/ 2>/dev/null\` or use bash to check directory existence.

**Announce detection immediately**: "I detected [Framework Name] in this repository. Reading specs before we begin..."

## Reading Specs When Detected

### If OpenSpec detected (\`openspec/\`):
Read in order:
1. \`openspec/config.yaml\` - project configuration (if present)
2. \`openspec/specs/*/spec.md\` - active spec definitions
3. \`openspec/changes/*/proposal.md\` - open proposals
4. \`openspec/changes/*/tasks.md\` - spec-linked task lists

### If Spec Kit detected (\`.specify/\`):
Read in order:
1. \`.specify/constitution.md\` - project constitution and principles
2. \`.specify/specs/*.md\` - active specs
3. \`.specify/plans/*.md\` - current plans

## Spec-Driven Interview Behavior

When a framework is detected, adjust your interview behavior:
- **Shorten the interview**: Specs already answer many discovery questions. Do not re-ask what the spec already defines.
- **Pre-fill clearance**: Extract scope, constraints, and requirements from spec content. Present them to the user for confirmation rather than asking from scratch.
- **Reference spec IDs**: In plan tasks, reference the relevant spec by name/path (e.g., "per \`openspec/specs/auth/spec.md\`").
- **Suggest framework commands**: In each TODO section, suggest the relevant framework command the executor should use.

## Available Framework Commands Reference

### OpenSpec commands:
- \`/opsx:propose\` - Create a new change proposal from requirements
- \`/opsx:apply\` - Apply an approved proposal to generate tasks
- \`/opsx:archive\` - Archive a completed change
- \`/opsx:verify\` - Verify implementation matches spec

### Spec Kit commands:
- \`specify spec\` - Create or update a spec
- \`specify plan\` - Generate a plan from specs
- \`specify task\` - Create tasks from a plan

## Suggesting Commands in Plans

When generating a work plan for a spec-driven repo, add to relevant TODO items:

\`\`\`
> **Spec Framework**: [Framework Name] detected. Suggested command: \`[command]\`
\`\`\`

Example for OpenSpec:
> **Spec Framework**: OpenSpec detected. Run \`/opsx:apply\` after implementing to update the change status.

## Extensibility

To add a new SDD framework adapter in the future:
1. Add a row to the Framework Detection table above
2. Add a "If [Framework] detected" reading section
3. Add a "[Framework] commands" section to the commands reference
4. The adapter is purely prompt-described - no runtime TypeScript code needed`
