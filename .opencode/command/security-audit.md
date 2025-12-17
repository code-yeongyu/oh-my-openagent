---
description: Comprehensive security review to identify and fix vulnerabilities in the codebase.
---

# Security Audit

## Overview

Perform a comprehensive security review to identify and fix vulnerabilities in the codebase. Focus on dependencies, code security, and infrastructure.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Dependency audit**
   - Check for known vulnerabilities in dependencies
   - Update outdated packages
   - Review third-party dependencies for security issues
   - Verify dependency sources are trusted

2. **Code security review**
   - Check for common vulnerabilities (OWASP Top 10)
   - Review authentication/authorization implementation
   - Audit data handling practices
   - Check for injection vulnerabilities (SQL, XSS, etc.)
   - Verify input validation and sanitization

3. **Infrastructure security**
   - Review environment variables handling
   - Check access controls and permissions
   - Audit network security configuration
   - Verify secrets management practices

4. **Sensitive data handling**
   - Check for hardcoded secrets or credentials
   - Verify encryption for sensitive data
   - Review logging for PII exposure
   - Check secure session management

5. **Generate security report**
   - Document findings with severity levels
   - Provide remediation recommendations
   - Prioritize fixes by risk

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for security audit
   - Include: vulnerabilities found, severity levels, remediation status

## Security Checklist

- [ ] Dependencies updated and secure
- [ ] No hardcoded secrets
- [ ] Input validation implemented
- [ ] Authentication secure
- [ ] Authorization properly configured
- [ ] Error messages don't leak sensitive info
- [ ] HTTPS/TLS used for sensitive data
- [ ] Rate limiting on public endpoints

## References

- Historian: `.opencode/agent/historian.md`
- Security Patterns: `.cursor/rules/03-security/security_patterns.mdc`
