export const INSTINCT_STATUS_TEMPLATE = `# /instinct-status Command

## Purpose
Display status report of all learned instincts.

## Instructions
1. Scan ~/.claude/skills/instincts/ directory
2. For each instinct SKILL.md, extract:
   - name, description, confidence, domain
   - trigger patterns, evidence count
   - last triggered timestamp
3. Format as table or list
4. Support sorting options

## Usage
/instinct-status                  # Show all instincts
/instinct-status --sort usage     # Sort by usage count
/instinct-status --sort confidence # Sort by confidence
/instinct-status --domain testing  # Filter by domain

## Output Format
| Name | Domain | Confidence | Usage | Last Triggered |
|------|--------|------------|-------|----------------|
| prefer-functional | code-style | 0.85 | 12 | 2h ago |
`;
