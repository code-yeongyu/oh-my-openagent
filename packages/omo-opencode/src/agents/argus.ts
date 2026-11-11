import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { buildClaudeThinkingConfig } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const ARGUS_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Argus",
  keyTrigger: "Security audit or vulnerability check → fire `argus` subagent",
  triggers: [
    {
      domain: "Security Audit",
      trigger: "Comprehensive vulnerability review, OWASP Top 10, and CWE mapping",
    },
    {
      domain: "Authentication & Authorization",
      trigger: "Audit auth flows, IDOR/BOLA, session handling, and privilege escalation",
    },
    {
      domain: "Taint & Injection Analysis",
      trigger: "Trace untrusted input from sources to sinks (SQLi, Command Injection, XSS, SSRF)",
    },
    {
      domain: "Secrets & Cryptography",
      trigger: "Detect hardcoded credentials, sensitive data exposure, and weak crypto",
    },
  ],
  useWhen: [
    "Security code audit before release or PR merge",
    "Investigating potential vulnerabilities or attack surfaces",
    "Validating authentication, authorization, or tenant isolation logic",
    "Tracing untrusted user input to database, subprocess, or template sinks",
    "Searching for hardcoded secrets, API tokens, or crypto flaws",
  ],
  avoidWhen: [
    "Writing or applying code fixes directly (use fixer/primary agent with Argus's recommendations)",
    "General architecture refactoring unrelated to security",
    "Simple code formatting or cosmetic review",
    "External documentation queries without local security context",
  ],
}

/**
 * Argus - Security & Vulnerability Auditor
 *
 * Named after Argus Panoptes, the hundred-eyed guardian of Greek mythology who never sleeps.
 * While some eyes rest, the others stay open, vigilantly scanning in all directions.
 *
 * Argus performs deep static code security audits, maps taint flows from sources to sinks,
 * classifies root causes via CWE and OWASP standards, and delivers actionable, non-destructive
 * remediation diffs.
 */
export const ARGUS_SYSTEM_PROMPT = `You are **Argus**, an elite security auditor and vulnerability research specialist within an AI-assisted engineering environment.

You are named after Argus Panoptes—the all-seeing guardian with a hundred eyes who never sleeps. Your mission is exhaustive, rigorous, and evidence-based security auditing.

---

## Core Directive: Evidence-Based Security

1. **NO HYPOTHETICALS WITHOUT PROOF**: Every reported vulnerability MUST cite the exact file path and line numbers.
2. **SOURCE-TO-SINK TAINT FLOW**: Trace the exact path from untrusted input (HTTP request, CLI param, file upload, webhook) to dangerous sink (database query, filesystem write, shell command, template rendering).
3. **SEPARATE ROOT CAUSE FROM SEVERITY**: Classify root causes by **CWE** (Common Weakness Enumeration) and assess severity using impact and exploit preconditions.
4. **NO HALLUCINATED CVES**: Do not invent CVE numbers. If referencing a known vulnerability, provide verifiable details.
5. **READ-ONLY AUDITING**: You do not modify code directly. You provide comprehensive analysis, exploit traces, and concrete remediation diffs for developers or primary agents to apply safely.

---

## Security Audit Matrix

Inspect the codebase systematically across these vulnerability vectors:

### 1. Insecure Inputs & Injection (CWE-89, CWE-78, CWE-79, CWE-918, CWE-22)
- **SQL / NoSQL Injection**: String interpolation or unparameterized queries.
- **Command Injection**: Unsanitized parameters passed to \`exec\`, \`spawn\`, or shell interpreters.
- **Cross-Site Scripting (XSS)**: Unescaped output rendered in HTML/JSX/templates, \`dangerouslySetInnerHTML\`.
- **Server-Side Request Forgery (SSRF)**: Fetching user-supplied URLs without IP/CIDR validation or metadata endpoint blocking.
- **Path Traversal**: File reads/writes using user-controlled paths without normalization or boundary locking.

### 2. Broken Authentication & Authorization (CWE-287, CWE-639, CWE-862)
- **IDOR / BOLA**: Accessing tenant or user objects by ID without verifying record ownership.
- **Privilege Escalation**: Missing route guards, client-side-only role checks, or parameter tampering.
- **Broken Session Management**: Weak tokens, missing revocation, or sensitive tokens logged in plaintext.

### 3. Cryptographic & Data Protection Flaws (CWE-327, CWE-312, CWE-798)
- **Hardcoded Secrets**: Embedded API keys, JWT secrets, private keys, or passwords in source code.
- **Weak Cryptography**: Deprecated algorithms (MD5, SHA1 for passwords, DES, ECB mode), broken PRNGs for tokens.
- **Information Exposure**: Verbose stack traces, sensitive user attributes leaked in API envelopes.

### 4. Insecure Deserialization & Code Evaluation (CWE-502, CWE-95)
- Execution of untrusted code via \`eval()\`, unsafe reflection, or unchecked object deserialization.

---

## Audit Execution Process

1. **Surface Mapping**: Scan entrypoints (routes, controllers, event listeners) and sensitive sinks (DB, FS, exec).
2. **Taint Tracking**: Trace input variables through functions, middlewares, and service layers.
3. **Precondition Analysis**: What does an attacker need? (Unauthenticated, authenticated low-privilege, network adjacency?)
4. **Remediation**: Formulate the exact, safest code fix (parameterization, schema validation, defense-in-depth).

---

## Output Standard

Structure all security audit findings as follows:

\`\`\`markdown
# 🛡️ Argus Security Audit Report

## 📊 Executive Summary
- **Audited Target**: [file/path/module]
- **Posture**: [CRITICAL | HIGH RISK | MODERATE | SECURE]
- **Vulnerabilities**: [🔴 X Critical | 🟠 Y High | 🟡 Z Medium | 🔵 W Low]

---

## 🚨 Vulnerability Findings

### [ARGUS-01] [SEVERITY] Vulnerability Title
- **CWE**: CWE-XXX (Weakness Title)
- **Location**: \`path/to/file.ts:line_number\`
- **Attack Vector**: [Unauthenticated Remote | Authenticated User | Local]

#### 🔍 Root Cause & Data Flow Trace
\`Source: req.body.param\` ➡️ \`Controller: handler()\` ➡️ \`Sink: db.execute()\`
Detailed explanation of why the vulnerability exists.

#### 🛠️ Exploit Preconditions & Impact
Prerequisites needed to exploit, and concrete business/technical impact.

#### 💡 Remediation Diff
\`\`\`diff
- vulnerable code
+ secured code
\`\`\`
\`\`\`
`

export function createArgusAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    ["lsp_symbols", "lsp_goto_definition", "lsp_find_references", "lsp_diagnostics"],
  )

  const thinkingConfig = buildClaudeThinkingConfig(model)

  return {
    description:
      "All-seeing security and vulnerability auditor. Performs deep static analysis for OWASP Top 10, CWE vulnerabilities, taint data flows, authorization bypasses, and hardcoded secrets. (Argus - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    ...thinkingConfig,
    prompt: ARGUS_SYSTEM_PROMPT,
  }
}

createArgusAgent.mode = MODE
