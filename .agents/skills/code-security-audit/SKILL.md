---
name: code-security-audit
description: "Comprehensive code security review and vulnerability assessment skill. Audits source code for OWASP Top 10, CWE vulnerabilities, IDOR/BOLA, injection flaws (SQLi, Command Injection, XSS, SSRF), authentication/authorization bypasses, hardcoded secrets, unsafe deserialization, path traversal, and cryptographic weaknesses. Use whenever auditing code security, reviewing PRs for security risks, hunting vulnerabilities, or hardening existing applications. Triggers: 'security audit', 'audit keamanan', 'cek keamanan code', 'vulnerability scan', 'code security review', 'analisa keamanan', 'owasp audit', 'security check'."
---

# Code Security Audit & Vulnerability Assessment

This skill provides a systematic, defense-oriented security audit methodology to identify, triage, and remediate vulnerabilities across web, mobile, and backend codebases.

---

## 1. Audit Principles

1. **Evidence-Based Findings**: Every finding must reference the exact file, line number(s), and code construct. No theoretical claims without an identifiable source-to-sink flow or architectural flaw.
2. **Standardized Classification**: Map root causes to **CWE** (Common Weakness Enumeration) and severity standards (**OWASP Top 10** / **CVSS v4.0** scoring frame).
3. **No Fluff / Direct Remediation**: Provide concrete, non-destructive reproduction steps or data flow traces, along with an actionable fix (before & after diff).
4. **Safe Verification**: Never run destructive payloads against production or third-party endpoints. Use static proof, symbolic data-flow tracing, or isolated local unit mocks.

---

## 2. Security Audit Matrix (What to Check)

### A. Authentication & Session Management (CWE-287, CWE-384)
- [ ] Hardcoded credentials, API keys, or JWT secrets in code or committed configuration files.
- [ ] Insecure password hashing (use of MD5, SHA-1, plain SHA-256 without bcrypt/Argon2/PBKDF2).
- [ ] Weak session token generation, missing expiry, or lack of token revocation upon logout/password reset.
- [ ] Broken MFA / OTP verification logic (missing rate-limiting, predictable tokens).

### B. Access Control & Authorization (CWE-285, CWE-639, CWE-862)
- [ ] **IDOR / BOLA**: Endpoints taking user/record IDs without validating that the authenticated user owns or has permission for that resource.
- [ ] Broken Object Property Level Authorization (mass assignment, exposing sensitive columns in ORM queries).
- [ ] Missing middleware or route guards on admin or sensitive endpoints.
- [ ] Vertical / Horizontal privilege escalation vulnerabilities.

### C. Injection Flaws (CWE-89, CWE-78, CWE-79, CWE-918)
- [ ] **SQL / NoSQL Injection**: Raw SQL queries concatenated with user input; unvalidated query building.
- [ ] **Command Injection**: `child_process.exec()`, `shell_exec()`, `Runtime.getRuntime().exec()` invoked with untrusted input.
- [ ] **XSS (Cross-Site Scripting)**: Unescaped template variables, `dangerouslySetInnerHTML`, `v-html`, unvalidated innerHTML assignments.
- [ ] **SSRF (Server-Side Request Forgery)**: User-controlled URLs passed directly to HTTP clients (`fetch`, `axios`, `curl`) without IP/hostname allowlisting or private IP blocking (e.g. `127.0.0.1`, `169.254.169.254`).

### D. File & Data Handling (CWE-22, CWE-434, CWE-502)
- [ ] **Path Traversal / LFI**: `fs.readFile(userInput)`, file downloads, or file inclusion without path sanitization (e.g. `../` normalization or basename locking).
- [ ] **Unrestricted File Upload**: Missing MIME/extension validation, missing file size limit, uploading executable files to publicly served directories.
- [ ] **Insecure Deserialization / Code Evaluation**: Use of `eval()`, `pickle.loads()`, `unserialize()`, or unchecked YAML parsing with code execution flags.

### E. Cryptography & Data Protection (CWE-327, CWE-312)
- [ ] Use of deprecated algorithms (DES, RC4, ECB mode, broken PRNGs like `Math.random()` for crypto/tokens).
- [ ] Insecure data storage (saving tokens, PII, passwords in plaintext in LocalStorage, SharedPreferences, unencrypted SQLite).
- [ ] Missing HTTPS enforcement or disabled TLS certificate validation (`rejectUnauthorized: false`).

### F. API & Configuration Hardening
- [ ] Missing CSRF protection on state-changing browser requests (cookies without SameSite/CSRF tokens).
- [ ] Permissive CORS (`Access-Control-Allow-Origin: *` combined with credentials).
- [ ] Leaking stack traces, internal database schema, or environment variables in error responses.
- [ ] Insecure HTTP headers (missing `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, etc.).

---

## 3. Audit Execution Workflow

When auditing a codebase or a specific PR/diff:

### Step 1: Reconnaissance & Entry Point Mapping
1. Identify all ingress points: HTTP routes, RPC handlers, WebSocket endpoints, webhook listeners, CLI arguments, file uploads.
2. Identify all sensitive assets & sinks: Database write/read calls, subprocess executions, file system writes, external API integrations, secret managers.

### Step 2: Data Flow & Taint Analysis
1. Trace user input from source (e.g., query params, request body, headers) to sinks (SQL query, file system, shell command, template rendering).
2. Check if sanitization, type-casting, or schema validation (e.g., Zod, FormRequest, Joi) is applied before the sink.

### Step 3: Vulnerability Triage & Impact Scoring
For each suspected flaw:
- Determine **Exploitability**: Can an unauthenticated or low-privilege attacker trigger it?
- Determine **Impact**: Confidentiality breach, integrity loss, or availability disruption?
- Assign severity:
  - **CRITICAL**: Remote Code Execution (RCE), unauthenticated SQLi, full auth bypass.
  - **HIGH**: IDOR/BOLA with PII leak or privilege escalation, SSRF to internal network, stored XSS.
  - **MEDIUM**: Reflected XSS, CSRF with low impact, hardcoded dev secrets, verbose error leak.
  - **LOW / INFO**: Missing security headers, weak cookie flags in non-sensitive contexts, defense-in-depth improvements.

---

## 4. Standard Audit Report Format

Format the audit results cleanly using the following markdown structure:

```markdown
# 🛡️ Code Security Audit Report

## 📊 Summary
- **Target**: [Path / Module / Repository]
- **Audit Date**: [Date]
- **Overall Posture**: [Critical / At Risk / Moderate / Secure]
- **Vulnerabilities Count**:
  - 🔴 Critical: X
  - 🟠 High: Y
  - 🟡 Medium: Z
  - 🔵 Low / Info: W

---

## 🚨 Detailed Findings

### [SEC-01] [Severity] Short Vulnerability Title
- **CWE**: [e.g. CWE-89: SQL Injection]
- **Location**: `[file/path.ext:line_number]`
- **Vulnerable Code Snippet**:
  ```language
  // exact snippet
  ```

#### 🔍 Description & Attack Vector
Explain how an attacker can leverage this weakness, the prerequisites needed, and the resulting impact.

#### 🛠️ Proof of Concept / Flow Trace
Trace the path from source to sink:
`Input: req.body.id` ➡️ `Controller: getUserData()` ➡️ `Sink: db.query(...)`

#### 💡 Remediation
Provide the exact code diff to eliminate the vulnerability safely:
```diff
- const query = `SELECT * FROM users WHERE id = '${userId}'`;
+ const query = `SELECT * FROM users WHERE id = ?`;
+ const [rows] = await db.execute(query, [userId]);
```

---

## 📋 Security Hardening Checklist & Recommendations
1. [Recommendation 1]
2. [Recommendation 2]
```
