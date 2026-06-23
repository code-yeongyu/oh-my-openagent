import type { BuiltinSkill } from "../types"

export const SECURITY_REVIEW_SKILL_NAME = "security-review"

const SECURITY_REVIEW_SKILL_DESCRIPTION =
  "Security review and threat modeling methodology: LLM-powered review phases, STRIDE threat model, attack surface mapping, architecture checklist, risk assessment, and report structure. Triggers: 'security review', 'threat model', 'STRIDE', 'attack surface', 'risk assessment', 'security architecture'."

export const securityReviewSkill: BuiltinSkill = {
  name: SECURITY_REVIEW_SKILL_NAME,
  description: SECURITY_REVIEW_SKILL_DESCRIPTION,
  template: `# Security — Review & Threat Modeling

## LLM-POWERED SECURITY REVIEW METHODOLOGY

- **Phase 1: Understand the application** (read architecture, data flow, trust boundaries)
- **Phase 2: Identify attack surface** (entry points, data inputs, external integrations, authentication boundaries)
- **Phase 3: Apply threat modeling** (STRIDE per component)
- **Phase 4: Code-level review** (focus on security-critical paths: auth, input handling, data access, crypto usage)
- **Phase 5: Generate findings report** with severity, CWE, remediation

## STRIDE THREAT MODEL

- **Spoofing**: Can an attacker pretend to be someone else? (auth weaknesses)
- **Tampering**: Can data be modified in transit or at rest? (integrity checks)
- **Repudiation**: Can actions be denied? (audit logging gaps)
- **Information Disclosure**: Can sensitive data leak? (error messages, logs, responses)
- **Denial of Service**: Can the service be overwhelmed? (rate limits, resource limits)
- **Elevation of Privilege**: Can a user gain unauthorized access? (authorization flaws)

## ATTACK SURFACE MAPPING

- **External interfaces**: APIs, web forms, file uploads, webhooks
- **Internal interfaces**: database connections, message queues, RPC calls
- **Data flows**: trace sensitive data from input to storage to output
- **Trust boundaries**: where does authenticated ↔ unauthenticated transition happen?
- **Third-party integrations**: external APIs, OAuth providers, payment gateways

## SECURITY ARCHITECTURE REVIEW CHECKLIST

- **Authentication**: Is it properly implemented? Multi-factor? Account lockout?
- **Authorization**: Is access control enforced consistently? At every layer?
- **Data protection**: Is sensitive data encrypted at rest and in transit?
- **Logging and monitoring**: Are security events logged? Are logs tamper-proof?
- **Error handling**: Do errors leak sensitive information?
- **Configuration**: Are defaults secure? Are debug features disabled in production?
- **Dependencies**: Are they up to date? Are there known vulnerabilities?

## RISK ASSESSMENT FRAMEWORK

- **Likelihood × Impact = Risk Rating**
- **Likelihood factors**: attacker skill required, access level needed, prevalence of vulnerability
- **Impact factors**: data confidentiality loss, integrity damage, availability impact, compliance implications
- **Risk ratings**: Critical (immediate fix), High (fix in current sprint), Medium (fix in next release), Low (track and plan)

## SECURITY REVIEW REPORT STRUCTURE

- Executive summary (1 paragraph for stakeholders)
- Scope and methodology
- Findings table (severity, CWE, location, description, remediation)
- Risk matrix visualization
- Recommendations prioritized by risk
- Appendix: detailed evidence for each finding
`,
}
