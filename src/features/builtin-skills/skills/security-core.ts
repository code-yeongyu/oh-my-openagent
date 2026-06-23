import type { BuiltinSkill } from "../types"

export const SECURITY_CORE_SKILL_NAME = "security-core"

const SECURITY_CORE_SKILL_DESCRIPTION =
  "Core security auditing principles, OWASP Top 10, CWE classification, severity scoring, and structured reporting. Triggers: 'security', 'audit', 'vulnerability', 'OWASP', 'CWE', 'security review'."

export const securityCoreSkill: BuiltinSkill = {
  name: SECURITY_CORE_SKILL_NAME,
  description: SECURITY_CORE_SKILL_DESCRIPTION,
  template: `# Security Core — Auditing & Vulnerability Management

## OWASP TOP 10 2021 CHECKLIST

| ID | Category | Description |
|----|----------|-------------|
| **A01** | Broken Access Control | Failures in enforcing user permissions and access rights. |
| **A02** | Cryptographic Failures | Exposure of sensitive data due to weak or missing encryption. |
| **A03** | Injection | Untrusted data sent to an interpreter as part of a command or query. |
| **A04** | Insecure Design | Flaws in architectural design and missing threat modeling. |
| **A05** | Security Misconfiguration | Insecure default settings, open cloud storage, verbose errors. |
| **A06** | Vulnerable and Outdated Components | Using libraries or frameworks with known vulnerabilities. |
| **A07** | Identification and Authentication Failures | Weak session management, credential stuffing, missing MFA. |
| **A08** | Software and Data Integrity Failures | Unverified CI/CD pipelines, insecure deserialization, untrusted updates. |
| **A09** | Security Logging and Monitoring Failures | Insufficient logging leading to undetected breaches. |
| **A10** | Server-Side Request Forgery (SSRF) | Fetching remote resources without validating the user-supplied URL. |

## CWE CLASSIFICATION QUICK REFERENCE (Top 25)

| CWE ID | Name |
|--------|------|
| CWE-787 | Out-of-bounds Write |
| CWE-79 | Improper Neutralization of Input During Web Page Generation (XSS) |
| CWE-89 | Improper Neutralization of Special Elements used in an SQL Command (SQLi) |
| CWE-20 | Improper Input Validation |
| CWE-125 | Out-of-bounds Read |
| CWE-78 | Improper Neutralization of Special Elements used in an OS Command (Command Injection) |
| CWE-416 | Use After Free |
| CWE-22 | Improper Limitation of a Pathname to a Restricted Directory (Path Traversal) |
| CWE-352 | Cross-Site Request Forgery (CSRF) |
| CWE-434 | Unrestricted Upload of File with Dangerous Type |
| CWE-476 | NULL Pointer Dereference |
| CWE-502 | Deserialization of Untrusted Data |
| CWE-190 | Integer Overflow or Wraparound |
| CWE-287 | Improper Authentication |
| CWE-798 | Use of Hard-coded Credentials |
| CWE-862 | Missing Authorization |
| CWE-276 | Incorrect Default Permissions |
| CWE-306 | Missing Authentication for Critical Function |
| CWE-863 | Incorrect Authorization |
| CWE-918 | Server-Side Request Forgery (SSRF) |
| CWE-295 | Improper Certificate Validation |
| CWE-732 | Incorrect Permission Assignment for Critical Resource |
| CWE-400 | Uncontrolled Resource Consumption |
| CWE-611 | Improper Restriction of XML External Entity Reference (XXE) |
| CWE-94 | Improper Control of Generation of Code (Code Injection) |

## SEVERITY CLASSIFICATION GUIDE

| Severity | Criteria | Action Required |
|----------|----------|-----------------|
| **Critical** | Direct system compromise, remote code execution (RCE), full database access, unauthenticated data exposure. | Immediate remediation required. Block deployment. |
| **High** | Significant data exposure, privilege escalation, authenticated injection, bypass of major security controls. | Remediate before next release. |
| **Medium** | Limited data exposure, CSRF, reflected XSS, denial of service (DoS) requiring specific conditions. | Schedule remediation in upcoming sprint. |
| **Low** | Information disclosure (versions, paths), missing security headers, weak password policies. | Add to backlog for future hardening. |
| **Informational** | Best practice deviations, defense-in-depth suggestions, theoretical risks without known exploits. | Note for architectural review. |

## STRUCTURED AUDIT REPORT FORMAT

When generating a security audit report, ALWAYS use the following markdown table format:

| # | Type | Severity | CWE | Location | Description | Remediation |
|---|------|----------|-----|----------|-------------|-------------|
| 1 | SQLi | High | CWE-89 | \`src/db.ts:42\` | Unsanitized user input in query. | Use parameterized queries. |
| 2 | XSS | Medium | CWE-79 | \`src/ui.tsx:15\` | \`dangerouslySetInnerHTML\` used. | Sanitize input with DOMPurify. |

## FALSE POSITIVE REDUCTION STRATEGIES

To minimize noise in security reports, verify the following before flagging an issue:
1. **Test Values**: Are the "secrets" clearly dummy values (e.g., \`password123\`, \`test_key\`)?
2. **Documentation Examples**: Is the code inside a \`README.md\`, \`docs/\` folder, or a comment block?
3. **Dead Code**: Is the vulnerable function unreachable or deprecated?
4. **Behind-Auth Checks**: Is the "unauthorized" action actually protected by middleware higher up in the stack?
5. **Internal Tools**: Is the script only run locally or in CI/CD without exposing external attack surfaces?

## TOOL GRACEFUL DEGRADATION

If automated security tools are unavailable, fallback to manual analysis:
- **If \`gitleaks\` is not installed**: Perform an LLM-only scan using regex patterns and entropy analysis for secrets.
- **If \`semgrep\` is not installed**: Conduct a manual pattern review focusing on high-risk sinks (e.g., \`eval\`, \`exec\`, \`innerHTML\`, raw SQL queries).
`,
}
