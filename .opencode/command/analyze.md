---
description: Analyze feature specification, plan, or implementation for issues, improvements, or insights.
---

## User Input

```text
$ARGUMENTS
```

## Outline

Analyze feature artifacts (spec, plan, implementation) for issues, improvements, or insights.

1. **Detect spec folder**:
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh` to find current spec folder
   - Or use `--spec-dir` argument if provided
   - Detect which artifacts exist: `spec.md`, `plan.md`, `tasks.md`, `implementation/`

2. **Determine analysis scope**:
   - If user specifies scope (e.g., "analyze spec", "analyze plan"), focus on that
   - Otherwise, analyze all available artifacts
   - Check for common issues:
     - Spec: Missing requirements, unclear success criteria, too many clarifications
     - Plan: Missing technical context, unclear architecture, complexity violations
     - Tasks: Missing dependencies, unclear organization, parallel opportunities missed
     - Implementation: Code quality, architecture compliance, test coverage

3. **Perform analysis**:
   - Read relevant artifacts
   - Identify issues, improvements, insights
   - Categorize findings (critical, important, nice-to-have)
   - Provide actionable recommendations

4. **Create analysis report**:
   - Write to `{SPEC_DIR}/analysis/analysis-{DATE}.md`
   - Include: findings, recommendations, priority
   - Link to relevant artifacts

5. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for analysis work
   - Include: analysis scope, findings count, recommendations

6. **Report completion**:
   - Analysis report path, key findings, recommendations

## Analysis Categories

### Specification Analysis
- Requirement completeness
- Success criteria measurability
- User story independence
- Clarification needs
- Edge case coverage

### Plan Analysis
- Technical context completeness
- Architecture clarity
- Constitution compliance
- Research depth
- Data model design

### Tasks Analysis
- Task organization
- Dependency clarity
- Parallel opportunities
- User story independence
- Test coverage

### Implementation Analysis
- Code quality
- Architecture compliance
- Test coverage
- Performance considerations
- Security considerations

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md`
- Tasks: `{SPEC_DIR}/tasks.md`
- Implementation: `{SPEC_DIR}/implementation/`
- Historian: `.opencode/agent/historian.md`
