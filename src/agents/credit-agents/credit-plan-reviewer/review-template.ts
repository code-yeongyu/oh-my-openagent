export const CREDIT_REVIEW_TEMPLATE = `## Plan Review Format

Generate review report to: \`.agentic-loop/reviews/{plan-name}-review.md\`

Use this format for comprehensive plan review:

\`\`\`markdown
# Plan Review: {Feature Name}

## Verdict: [APPROVE | REJECT | APPROVE_WITH_CHANGES]

## Summary
2-3 sentence overall assessment of the plan quality and readiness.

## Detailed Findings

### Critical Issues (Must Fix Before Execution)
| # | Issue | Location | Problem | Required Fix |
|---|-------|----------|---------|--------------|
| 1 | [Brief description] | [File/section] | [What's wrong] | [What must change] |
| 2 | ... | ... | ... | ... |

### Warnings (Should Fix)
| # | Issue | Location | Problem | Recommended Fix |
|---|-------|----------|---------|-----------------|
| 1 | [Brief description] | [File/section] | [What's wrong] | [What should change] |
| 2 | ... | ... | ... | ... |

### Suggestions (Nice to Have)
| # | Suggestion | Benefit |
|---|------------|---------|
| 1 | [Description] | [Why it's better] |
| 2 | ... | ... |

## Compliance Checklist

### Architecture Compliance
- [ ] Core API follows 6-layer structure (if applicable)
- [ ] Wrapper API follows 4-layer structure (if applicable)
- [ ] File paths follow naming conventions
- [ ] Auth handled in correct layer
- [ ] Business logic not in HTTP layer
- [ ] UseCaseA pattern used correctly

### Completeness
- [ ] All necessary files listed
- [ ] Database migrations included
- [ ] Error handling specified
- [ ] All product types covered (ConsumerCredit, PersonalLoan, etc.)
- [ ] All clients covered (FlipKart, JuspaySDK, etc.)
- [ ] Edge cases considered

### Risk Assessment
- [ ] Concurrent operations handled (idempotency)
- [ ] Database transactions specified
- [ ] External service failures considered
- [ ] PII encryption mentioned (if applicable)
- [ ] Breaking changes identified
- [ ] Rollback strategy provided

### Standards
- [ ] Naming conventions followed
- [ ] Type conventions followed
- [ ] No anti-patterns
- [ ] Consistent with decision-log
- [ ] Haskell best practices

## Scores

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Architecture | X | 10 | [Notes] |
| Completeness | X | 10 | [Notes] |
| Risk Assessment | X | 10 | [Notes] |
| Standards | X | 10 | [Notes] |
| **Overall** | **X** | **40** | [Notes] |

## Specific Feedback by Section

### Overview Section
[Feedback on clarity, scope definition, acceptance criteria]

### Files to Modify Section
[Feedback on file paths, missing files, incorrect structure]

### APIs and Services Section
[Feedback on endpoint definitions, auth, request/response schemas]

### Database Changes Section
[Feedback on migrations, schema changes, data backfill]

### Test Flows Section
[Feedback on test coverage, edge cases, validation steps]

### Risk Areas Section
[Feedback on risk identification, mitigation strategies]

## Reference Check

Compare against:
- [ ] GetLenderFlows (for Core APIs)
- [ ] FlipKart/CreateLoan (for Wrapper APIs)
- [ ] Existing similar implementations in codebase

## Next Steps

Based on verdict:
- **APPROVE**: Plan is ready for execution. Delegate to credit-executor.
- **APPROVE_WITH_CHANGES**: Address the Critical Issues and Warnings above, then re-submit for review.
- **REJECT**: Plan needs significant revision. Return to credit-planner with detailed feedback.

## Review Metadata
- Reviewer: credit-reviewer
- Plan Version: {version/timestamp}
- Review Date: {date}
- Time Spent: {minutes}
\`\`\`
`

export const REVIEW_CHECKLIST = {
  architecture: `
### Architecture Review
- Verify 6-layer Core API structure (Types → Errors → Impl/Common → Impl/Product → Flow → CommonDecider → Endpoints)
- Verify 4-layer Wrapper API structure (Types → Transform → Product → EndPoint)
- Check file paths match conventions exactly
- Confirm auth is in correct layer (EndPoint for Wrapper, handled separately for Core)
- Ensure business logic is not in HTTP handlers
- Verify UseCaseA GADT pattern is used correctly`,

  completeness: `
### Completeness Review
- Check all necessary files are listed
- Verify database migrations are included
- Confirm error handling is specified for all error scenarios
- Check all product types are covered (ConsumerCredit, PersonalLoan, BusinessLoan)
- Verify all clients are considered (FlipKart, JuspaySDK, TSPHyperCredit)
- Look for missing edge cases`,

  riskAssessment: `
### Risk Assessment Review
- Check for idempotent create patterns where needed
- Verify database transactions for multi-table operations
- Look for external service failure handling
- Confirm PII encryption is mentioned if handling sensitive data
- Identify any breaking changes
- Verify rollback strategy is practical`,

  standards: `
### Standards Review
- Check naming conventions (camelCase vs PascalCase consistency)
- Verify type conventions (domain types vs Beam types)
- Look for anti-patterns (raw SQL, deep nesting, beam types leaked)
- Confirm consistency with decision-log.md
- Check Haskell best practices (type signatures, purity, error handling)`,
}

export const VERDICT_GUIDELINES = {
  approve: `
### APPROVE Verdict Criteria
Use when ALL of the following are true:
- No Critical Issues
- At most 1-2 minor Warnings
- Architecture score ≥ 8/10
- Completeness score ≥ 8/10
- Risk Assessment score ≥ 8/10
- Standards score ≥ 8/10
- Overall score ≥ 32/40`,

  approveWithChanges: `
### APPROVE_WITH_CHANGES Verdict Criteria
Use when:
- 1-3 Critical Issues that are easily fixable
- OR several Warnings that should be addressed
- Architecture score ≥ 6/10
- Completeness score ≥ 6/10
- Risk Assessment score ≥ 6/10
- Standards score ≥ 6/10
- Overall score 24-31/40`,

  reject: `
### REJECT Verdict Criteria
Use when ANY of the following are true:
- 4+ Critical Issues
- OR fundamental architecture problems
- OR major safety concerns
- Architecture score < 6/10
- Completeness score < 6/10
- Risk Assessment score < 6/10
- Standards score < 6/10
- Overall score < 24/40`,
}
