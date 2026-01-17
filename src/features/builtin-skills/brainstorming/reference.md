## Templates

### proposal.md Template

```markdown
# Proposal: <name>

## Why

[1-2 sentences explaining the motivation and problem being solved]

## What

[1-2 sentences describing what will be built/changed]

## Impact

- **Files affected**: [list key files/directories]
- **Risk tier**: [Tier 0/1/2/3]
- **Estimated scope**: [small/medium/large]

## Success Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Open Questions

- [ ] Question 1 (if any)
```

### Options Table Template

Use when presenting 2-3 approaches:

```markdown
| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A: [Name]** | [benefits] | [drawbacks] | [low/medium/high] |
| **B: [Name]** | [benefits] | [drawbacks] | [low/medium/high] |
| **C: [Name]** | [benefits] | [drawbacks] | [low/medium/high] |

**Recommendation**: Option [X] because [reasoning].
```

### status.json Template

```json
{
  "currentChange": "<name>",
  "startedAt": "<ISO timestamp>",
  "phase": "proposal",
  "tasks": {}
}
```

## Best Practices

- Favor breadth first, depth second; avoid prematurely committing
- Include constraints: time, risk tolerance, team skills, existing infra
- Use quick filters: complexity, blast radius, dependency count, reversibility
- After design validation, create change directory and proposal immediately

## Heuristics

- **Complexity**: How many moving parts?
- **Blast radius**: What could break if this fails?
- **Dependencies**: External services, libraries, team coordination
- **Reversibility**: Can we easily undo if it doesn't work?

## Common Pitfalls

- Anchoring on first idea
- Ignoring non-technical constraints (timeline, team capacity)
- Over-engineering vs. pragmatic solutions
- Skipping proposal creation after design validation

## Workflow Integration

After brainstorming completes:
1. Change directory created: `changes/<name>/`
2. Proposal written: `changes/<name>/proposal.md`
3. Hand off to `creating-changes` skill for design and task breakdown
