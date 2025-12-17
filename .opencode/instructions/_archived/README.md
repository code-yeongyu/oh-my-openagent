# Archived Instructions

These instruction files have been merged into their respective agent files for better sync compatibility.

## Archived Files

| File | Merged Into | Date |
|------|-------------|------|
| `linear-workflow.md` | `.opencode/agent/linear-coordinator.md` | 2024-12-16 |
| `documentation-standards.md` | `.opencode/agent/documentation-master.md` | 2024-12-16 |

## Rationale

Per the OpenCode architecture review, agent-specific instructions should be embedded in agent files rather than loaded via `opencode.json` instructions. This:

1. Makes agents self-contained and sync-friendly
2. Reduces instruction file proliferation
3. Ensures agents work across projects without opencode-specific dependencies

## Project-Wide Instructions (Still Active)

The following remain in `opencode.json` instructions as they are truly project-wide:

- `governance.md` - Agent organization, Linear rules, commit standards
- `custom-tools.md` - Project-wide tool reference
- `deepwiki-integration.md` - Project-wide MCP guidance
