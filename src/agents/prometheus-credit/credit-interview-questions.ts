/**
 * Prometheus-Credit Interview Questions
 *
 * Credit-domain specific interview flow for loan/lender integrations.
 * Guides users through clarifying questions before planning.
 */

export const CREDIT_INTERVIEW_QUESTIONS = `# CREDIT DOMAIN INTERVIEW MODE

## Purpose

Before planning any credit/lending integration work, gather domain-specific context
to ensure the plan accounts for lender APIs, compliance requirements, and data flows.

---

## The 8 Credit Interview Questions

### Question 1: Lender API Version
**"Which lender API version are you working with? (V3.5, V4, V4.1, Mod)"**

Options:
- **V3.5** - Legacy stable, limited async support
- **V4** - Current standard, webhook-based callbacks
- **V4.1** - Latest with enhanced error codes
- **Mod** - Custom/modified lender integration

**Branching Logic:**
- If V3.5 → Ask about polling strategy for status checks
- If V4/V4.1 → Ask about webhook endpoint availability
- If Mod → Ask for API documentation link

---

### Question 2: Loan Lifecycle Stage
**"What stage of the loan lifecycle? (Application, KYC, Disbursement, Repayment)"**

Stages:
- **Application** - New loan application submission
- **KYC** - Identity verification and document collection
- **Disbursement** - Fund transfer to borrower
- **Repayment** - EMI/loan repayment processing

**Branching Logic:**
- If Application → Ask about eligibility pre-check needs
- If KYC → Ask about document types (PAN, Aadhaar, Bank Statements)
- If Disbursement → Ask about payout modes (NEFT, IMPS, UPI)
- If Repayment → Ask about mandate types (NACH, UPI AutoPay)

---

### Question 3: Credit Bureau Integration
**"Which credit bureau integration? (CIBIL, Experian, CRIF)"**

Options:
- **CIBIL** - TransUnion CIBIL (most common in India)
- **Experian** - Experian India
- **CRIF** - CRIF High Mark
- **Multiple** - Bureau aggregation needed

**Branching Logic:**
- If CIBIL → Ask about commercial vs retail bureau
- If Multiple → Ask about waterfall/fallback strategy
- Any → Ask about bureau report caching requirements

---

### Question 4: KYC Provider Preference
**"KYC provider preference? (HyperVerge, Karza, or other)"**

Options:
- **HyperVerge** - AI-based document verification
- **Karza** - Financial data verification specialist
- **Internal** - In-house KYC system
- **Other** - Specify provider

**Branching Logic:**
- If HyperVerge/Karza → Ask about API key environment
- If Internal → Ask about integration interface
- Any → Ask about KYC retry limits and failure handling

---

### Question 5: Eligibility Check Type
**"Soft pull or hard pull eligibility check?"**

Types:
- **Soft Pull** - Bureau inquiry without credit score impact (pre-approval)
- **Hard Pull** - Full bureau inquiry (post-consent, formal application)
- **Both** - Soft for eligibility, hard for final approval

**Branching Logic:**
- If Soft → Ask about consent requirements (even for soft)
- If Hard → Ask about explicit consent capture flow
- If Both → Ask about stage transition logic

---

### Question 6: BRE Rules and Validation
**"Are there specific BRE rules or validation requirements?"**

BRE (Business Rules Engine) considerations:
- **Risk Rules** - Credit score thresholds, DTI ratios
- **Product Rules** - Loan amount limits, tenure restrictions
- **Fraud Rules** - Velocity checks, device fingerprinting
- **Custom Rules** - Lender-specific criteria

**Branching Logic:**
- If Risk Rules → Ask about rule versioning strategy
- If Fraud Rules → Ask about third-party fraud service integration
- Any → Ask about rule execution order and priority

---

### Question 7: PII Handling Requirements
**"PII handling requirements - any new encrypted fields?"**

PII Scope:
- **Standard Fields** - Name, phone, email, address
- **Financial Data** - Bank account, IFSC, income details
- **Document Images** - PAN, Aadhaar scans
- **Bureau Data** - Full credit report, score

**Branching Logic:**
- If New Fields → Ask about encryption key management
- If Document Images → Ask about storage (S3, internal) and retention
- Any → Ask about data masking requirements in logs

---

### Question 8: Integration Flow Type
**"Integration with existing Order/Txn flow or new workflow?"**

Options:
- **Existing Order Flow** - Extend current order system
- **Existing Txn Flow** - Use transaction service
- **New Workflow** - Standalone credit-specific flow
- **Hybrid** - Some steps reuse, some are new

**Branching Logic:**
- If Existing → Ask which services to extend (naming conventions)
- If New → Ask about service naming and directory structure
- If Hybrid → Ask about handoff points between old and new

---

## Interview Flow Patterns

### Sequential Flow (Default)
Ask questions 1-8 in order. Record answers after each.

### Priority Flow (Time-constrained)
Ask the 3 most critical first:
1. Question 2 (Lifecycle Stage) - determines scope
2. Question 1 (API Version) - determines technical approach
3. Question 8 (Integration Type) - determines architectural impact

Then ask remaining 5 based on initial answers.

### Conditional Flow (Experienced User)
If user mentions specific context upfront, skip redundant questions:
- User says "adding disbursement to existing V4 flow" → Skip Q1, Q2
- User says "new KYC provider integration" → Skip Q1, jump to Q4

---

## Recording Answers

After each question, record:

\`\`\`markdown
## Credit Context: [Question Topic]
**Answer:** [User response]
**Implications:**
- [Technical implication 1]
- [Technical implication 2]
**Follow-up Needed:** [Yes/No - which questions]
\`\`\`

---

## Anti-Patterns to Avoid

**NEVER:**
- Ask about implementation details ("which database table?")
- Assume specific lender names (keep it generic)
- Suggest code structure before understanding requirements
- Skip PII questions for production-bound features

**ALWAYS:**
- Clarify ambiguous terms ("What do you mean by 'fast'?")
- Confirm security requirements for any data handling
- Note compliance requirements (RBI, data localization)
- Record all answers before proceeding to planning
`
