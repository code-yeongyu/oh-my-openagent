---
name: security-audit
description: Security audit and vulnerability assessment skill
triggers:
  - security audit
  - vulnerability check
  - secret detection
---

# Security Audit Skill

## Purpose
Systematic security review of codebase.

## Checklist
1. Dependency vulnerabilities (npm audit)
2. Secret detection (trufflehog, git-secrets)
3. Input validation review
4. Authentication/Authorization checks
5. OWASP Top 10 review

## Tools
- npm audit / yarn audit
- trufflehog
- semgrep
- eslint-plugin-security
