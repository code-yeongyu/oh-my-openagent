/**
 * Prometheus-Credit Plan Template
 *
 * Credit-domain specific plan template for loan lifecycle orchestration.
 * Covers KYC, bureau assessment, disbursement, and repayment stages.
 */

export const CREDIT_PLAN_TEMPLATE = `## Credit Plan Structure

Generate credit plan to: \`.sisyphus/plans/{name}.md\`

\`\`\`markdown
# {Plan Title}

## TL;DR

> **Quick Summary**: [1-2 sentences capturing the credit workflow objective]
>
> **Deliverables**: [Bullet list of concrete credit system outputs]
> - [Output 1]
> - [Output 2]
>
> **Estimated Effort**: [Quick | Short | Medium | Large | XL]
> **Parallel Execution**: [YES - N waves | NO - sequential]
> **Critical Path**: [Task X → Task Y → Task Z]
> **State Machine**: [Initial → KYC → Bureau → Application → Offer → Agreement → Disbursement → Repayment]

---

## Context

### Original Request
[User's credit system description]

### Interview Summary
**Key Requirements**:
- [Point 1]: [Credit workflow decision]
- [Point 2]: [Integration preference]

**Risk Assessment**:
- [Risk 1]: [Mitigation approach]
- [Risk 2]: [Mitigation approach]

### Compliance Review
**Identified Gaps** (addressed):
- [Gap 1]: [How resolved]
- [Gap 2]: [How resolved]

---

## Work Objectives

### Core Objective
[1-2 sentences: credit workflow being implemented]

### Concrete Deliverables
- [Exact service/handler/state definition]

### Definition of Done
- [ ] [Verifiable condition with command]

### Must Have
- [Non-negotiable credit requirement]

### Must NOT Have (Guardrails)
- [Explicit exclusion]
- [AI slop pattern to avoid]
- [Scope boundary]

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: [YES/NO]
- **Automated tests**: [TDD / Tests-after / None]
- **Framework**: [bun test / vitest / jest / pytest / none]
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to \`.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}\`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **TUI/CLI**: Use interactive_bash (tmux) — Run command, send keystrokes, validate output
- **API/Backend**: Use Bash (curl) — Send requests, assert status + response fields
- **Library/Module**: Use Bash (bun/node REPL) — Import, call functions, compare output

---

## Credit Lifecycle Execution Waves

### Stage 1: KYC Verification Stage

> Identity verification and document validation. PII handling with encryption requirements.
> State: INITIAL → KYC_IN_PROGRESS → KYC_COMPLETE | KYC_FAILED

\`\`\`
Wave 1 (KYC Foundation):
├── Task 1: KYC document collection [quick]
├── Task 2: Identity verification handler [quick]
├── Task 3: PII encryption at rest [quick]
└── Task 4: KYC status state machine [quick]

Compliance Check:
- PII fields encrypted (AES-256-GCM)
- Document retention policy enforced
- Identity verification audit log
\`\`\`

### Stage 2: Bureau/Credit Assessment

> Soft pull pre-qualification, hard pull on acceptance. Bureau integration with retry logic.
> State: KYC_COMPLETE → BUREAU_SOFT_PULL → BUREAU_HARD_PULL → ASSESSMENT_COMPLETE

\`\`\`
Wave 2 (Bureau Assessment):
├── Task 5: Soft pull integration [quick]
├── Task 6: Credit score evaluation [unspecified-high]
├── Task 7: Hard pull trigger (conditional) [quick]
├── Task 8: Bureau response caching [quick]
└── Task 9: Retry/fallback logic [deep]

Compliance Check:
- FCRA compliance for hard pulls
- Consent recorded before hard pull
- Bureau error handling without PII leak
\`\`\`

### Stage 3: Loan Application Processing

> Application data validation, eligibility checks, risk scoring.
> State: ASSESSMENT_COMPLETE → APPLICATION_RECEIVED → APPLICATION_PROCESSING → APPLICATION_APPROVED | APPLICATION_DECLINED

\`\`\`
Wave 3 (Application Processing):
├── Task 10: Application validation schema [quick]
├── Task 11: Eligibility engine [deep]
├── Task 12: Risk scoring integration [unspecified-high]
├── Task 13: Application state transitions [quick]
└── Task 14: Decline reason logging [quick]

PII Encryption:
- Application data encrypted
- Audit trail of all decisions
\`\`\`

### Stage 4: Offer Generation & Selection

> Generate personalized loan offers, present options, capture selection.
> State: APPLICATION_APPROVED → OFFER_GENERATED → OFFER_SELECTED | OFFER_EXPIRED

\`\`\`
Wave 4 (Offer Management):
├── Task 15: Offer calculation engine [deep]
├── Task 16: Offer presentation handler [quick]
├── Task 17: Offer expiration logic [quick]
└── Task 18: Selection capture API [quick]

Async Callback:
- Webhook on offer generation
- SMS/email notification (async)
\`\`\`

### Stage 5: Terms Acceptance & Agreement

> E-signature capture, terms acknowledgment, agreement storage.
> State: OFFER_SELECTED → AGREEMENT_PENDING → AGREEMENT_SIGNED | AGREEMENT_DECLINED

\`\`\`
Wave 5 (Agreement Flow):
├── Task 19: Terms document generation [quick]
├── Task 20: E-signature integration [unspecified-high]
├── Task 21: Agreement storage (encrypted) [quick]
└── Task 22: Acknowledgment logging [quick]

Compliance Check:
- E-sign compliance (ESIGN Act, UETA)
- Terms version tracking
- Immutable agreement record
\`\`\`

### Stage 6: Disbursement Setup

> Bank account verification, disbursement scheduling, NACHA/ACH preparation.
> State: AGREEMENT_SIGNED → DISBURSEMENT_PENDING → DISBURSEMENT_SCHEDULED

\`\`\`
Wave 6 (Disbursement Preparation):
├── Task 23: Bank account verification [unspecified-high]
├── Task 24: Disbursement scheduler [quick]
├── Task 25: ACH file generation [quick]
└── Task 26: Disbursement confirmation handler [quick]

Async Callback:
- Webhook on disbursement complete
- Real-time status updates
\`\`\`

### Stage 7: Payment Plan Configuration

> Installment schedule generation, autopay setup, payment method storage.
> State: DISBURSEMENT_SCHEDULED → PAYMENT_PLAN_ACTIVE

\`\`\`
Wave 7 (Payment Setup):
├── Task 27: Installment schedule generator [quick]
├── Task 28: Autopay enrollment [unspecified-high]
├── Task 29: Payment method tokenization [quick]
└── Task 30: Payment reminder setup [quick]

PII Encryption:
- Payment credentials tokenized
- No raw card/bank data stored
\`\`\`

### Stage 8: Repayment Tracking Integration

> Payment processing, delinquency monitoring, collections handoff.
> State: PAYMENT_PLAN_ACTIVE → PAYMENT_DUE → PAYMENT_RECEIVED | PAYMENT_LATE → [COLLECTIONS if applicable]

\`\`\`
Wave 8 (Repayment Operations):
├── Task 31: Payment processing handler [unspecified-high]
├── Task 32: Delinquency monitor [quick]
├── Task 33: Collections trigger logic [quick]
├── Task 34: Payment reconciliation [unspecified-high]
└── Task 35: Statement generation [quick]

State Machine Awareness:
- Auto-transition on payment receipt
- Grace period handling
- Collections escalation rules
\`\`\`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

- [ ] 1. [Task Title]

  **What to do**:
  - [Clear implementation steps]
  - [Test cases to cover]

  **Must NOT do**:
  - [Specific exclusions from guardrails]

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: [visual-engineering | ultrabrain | artistry | quick | unspecified-low | unspecified-high | writing]
    - Reason: [Why this category fits the credit domain task]
  - **Skills**: [skill-1, skill-2]
    - skill-1: [Why needed - domain overlap explanation]
    - skill-2: [Why needed - domain overlap explanation]

  **Parallelization**:
  - **Can Run In Parallel**: YES | NO
  - **Parallel Group**: Wave N (with Tasks X, Y) | Sequential
  - **Blocks**: [Tasks that depend on this task completing]
  - **Blocked By**: [Tasks this depends on] | None (can start immediately)

  **State Machine Context**:
  - **Current State**: [State before this task]
  - **Transitions**: [Possible next states after completion]
  - **Rollback State**: [State to revert to on failure]

  **References** (CRITICAL - Be Exhaustive):

  > The executor has NO context from your interview. References are their ONLY guide.
  > Each reference must answer: "What should I look at and WHY?"

  **Pattern References** (existing code to follow):
  - src/services/kyc.ts:45-78 - KYC validation flow pattern

  **API/Type References** (contracts to implement against):
  - src/types/credit.ts:LoanApplicationDTO - Application schema

  **Test References** (testing patterns to follow):
  - src/__tests__/credit.test.ts:describe("bureau") - Bureau integration test patterns

  **External References** (libraries and frameworks):
  - Official docs: https://docs.example.com/credit-api - Bureau API documentation

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.
  > Every criterion MUST be verifiable by running a command or using a tool.

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  Scenario: [Happy path — successful credit operation]
    Tool: [Playwright / interactive_bash / Bash (curl)]
    Preconditions: [Exact setup state - valid KYC, approved credit]
    Steps:
      1. [Exact action — specific API call with test data]
      2. [Next action — state verification]
      3. [Assertion — exact expected response/state]
    Expected Result: [Concrete, observable, binary pass/fail]
    Failure Indicators: [What specifically would mean this failed]
    Evidence: .sisyphus/evidence/task-{N}-{scenario-slug}.{ext}

  Scenario: [Failure/edge case — compliance or PII violation]
    Tool: [same format]
    Preconditions: [Invalid input / missing consent / PII exposure risk]
    Steps:
      1. [Trigger the error/compliance condition]
      2. [Assert error is handled correctly - no PII leak]
    Expected Result: [Graceful failure with audit log entry]
    Evidence: .sisyphus/evidence/task-{N}-{scenario-slug}-error.{ext}

  **Evidence to Capture**:
  - [ ] Each evidence file named: task-{N}-{scenario-slug}.{ext}
  - [ ] State transition logs
  - [ ] Audit trail entries
  - [ ] Screenshots for UI flows

  **Commit**: YES | NO (groups with N)
  - Message: type(scope): desc
  - Files: path/to/file
  - Pre-commit: test command

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — oracle
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Verify all state machine transitions are implemented. Check evidence files exist.
  Output: Must Have [N/N] | Must NOT Have [N/N] | States [N/N] | VERDICT: APPROVE/REJECT

- [ ] F2. **Code Quality Review** — unspecified-high
  Run tsc --noEmit + linter + bun test. Review all changed files for: PII handling correctness, encryption usage, compliance comments.
  Output: Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | PII Review [PASS/FAIL] | VERDICT

- [ ] F3. **Real Manual QA** — unspecified-high
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test state machine: valid transitions, invalid transitions, rollback scenarios. Verify PII never logged in plaintext.
  Output: Scenarios [N/N pass] | State Machine [N/N] | PII Safety [PASS/FAIL] | VERDICT

- [ ] F4. **Scope Fidelity Check** — deep
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance.
  Output: Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT

---

## Commit Strategy

- **1**: type(scope): desc — file.ts, npm test

---

## Success Criteria

### Verification Commands
type command here with expected output

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All state transitions implemented
- [ ] PII encryption verified
- [ ] Compliance requirements met
- [ ] All tests pass
\`\`\`

---
`;
