export const CREDIT_DOMAIN_KNOWLEDGE = `
# Credit Domain Entities

## Core Entities
- **LoanApplication**: Tracks loan request from submission through approval/rejection
- **LoanDetail**: Active loan state post-disbursement (EMI schedule, repayment tracking)
- **Offer**: Eligible loan products with terms (amount, tenure, interest rate)
- **Borrower**: Primary loan applicant entity with credit profile
- **Applicant**: Person applying for loan (may differ from borrower in some flows)
- **Guarantor**: Third-party backing the loan (optional)
- **KYC**: Identity verification data (PAN, address proof, photo)
- **BureauReport**: Credit bureau data (CIBIL, Equifax) with score and history

## State Machine
INITIATED → IN_PROGRESS → APPROVED → DISBURSED → ACTIVE → CLOSED

Rejected applications terminate from IN_PROGRESS or APPROVED states.

## Core Data Flow
MerchantUser → LoanRequestInfo → LoanApplication → Offers → LoanDetail

## Key Terminology
- **LSP**: Lender Service Provider (Haskell-based backend system)
- **Soft Pull**: Eligibility check (no credit score impact, preliminary assessment)
- **Hard Pull**: Full application (affects credit score, generates bureau inquiry)
- **KYC**: Know Your Customer (regulatory identity verification)
- **EMI**: Equated Monthly Installment (loan repayment schedule)
- **PII encryption**: Passetto-encrypted personally identifiable information (separate PiiName, PiiPan tables)
`;

