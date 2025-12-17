---
description: Clarify specification requirements that need clarification.
---

## User Input

```text
$ARGUMENTS
```

## Outline

Clarify specification requirements marked with [NEEDS CLARIFICATION] markers.

1. **Detect spec folder**:
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh` to find current spec folder
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists

2. **Read spec.md**:
   - Find all [NEEDS CLARIFICATION: ...] markers
   - Extract clarification questions
   - **LIMIT**: Maximum 3 clarifications (keep most critical)

3. **Present clarification questions**:
   - Format each question with context, options, and implications
   - Present all questions together
   - Wait for user responses

4. **Update spec.md**:
   - Replace [NEEDS CLARIFICATION] markers with user-provided answers
   - Update relevant sections with clarified requirements
   - Maintain spec structure and formatting

5. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for clarification work
   - Include: clarifications resolved, spec updates

6. **Report completion**:
   - Clarifications resolved, spec updated, readiness for `/plan`

## Clarification Format

For each clarification, present:

```markdown
## Question [N]: [Topic]

**Context**: [Quote relevant spec section]

**What we need to know**: [Specific question from NEEDS CLARIFICATION marker]

**Suggested Answers**:

| Option | Answer | Implications |
|--------|--------|--------------|
| A      | [First option] | [What this means] |
| B      | [Second option] | [What this means] |
| C      | [Third option] | [What this means] |
| Custom | Provide your own | [How to provide] |

**Your choice**: _[Wait for user response]_
```

## Clarification Priority

When more than 3 clarifications exist, prioritize by:
1. **Scope impact** (affects feature boundaries)
2. **Security/privacy** (legal/financial implications)
3. **User experience** (affects user flows)
4. **Technical details** (implementation choices)

## References

- Spec: `{SPEC_DIR}/spec.md`
- Historian: `.opencode/agent/historian.md`
