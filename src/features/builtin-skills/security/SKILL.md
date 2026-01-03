# Security Skill

Enterprise security scanning for code analysis, dependency auditing, and compliance checking.

## Commands

- `/security scan [paths]` - Run SAST scan on codebase
- `/security audit [target]` - Comprehensive security audit
- `/security secrets [paths]` - Detect hardcoded secrets
- `/security deps [lockfile]` - Scan dependencies for vulnerabilities
- `/security compliance <framework>` - Check compliance requirements

## SAST Scanning

```
/security scan
/security scan src/ --severity high
/security scan --rules owasp-top-10 --exclude tests/
```

Scans for:
- SQL/NoSQL injection
- Cross-site scripting (XSS)
- Path traversal
- Command injection
- Insecure deserialization
- Authentication bypasses
- Cryptographic weaknesses

## Security Audit

```
/security audit
/security audit --target code --format sarif
/security audit --target all
```

Targets:
- **code**: Static analysis (Semgrep)
- **deps**: Dependency vulnerabilities (Snyk)
- **secrets**: Hardcoded credentials
- **all**: Complete security audit

## Secrets Detection

```
/security secrets
/security secrets src/ --verify
```

Detects:
- API keys
- AWS credentials
- Private keys
- Database connection strings
- OAuth tokens
- Webhook URLs

## Dependency Scanning

```
/security deps
/security deps --lockfile package-lock.json --severity critical
/security deps --dev  # Include dev dependencies
```

Checks:
- Known CVEs
- Outdated packages
- License compliance
- Transitive dependencies

## Compliance Checking

```
/security compliance soc2
/security compliance pci --scope payments/
/security compliance gdpr
```

Frameworks:
- **SOC2**: Service Organization Control
- **PCI**: Payment Card Industry DSS
- **HIPAA**: Health Insurance Portability
- **GDPR**: General Data Protection Regulation

## Severity Levels

| Level | Examples |
|-------|----------|
| critical | RCE, SQLi, hardcoded secrets |
| high | XSS, auth bypass, SSRF |
| medium | CSRF, info disclosure |
| low | Best practice violations |

## Integrations

### Semgrep

Set environment variables:
- SEMGREP_APP_TOKEN: Your Semgrep App token (optional, for cloud features)
- SEMGREP_DEPLOYMENT_ID: Semgrep deployment ID (optional)

Semgrep runs locally without authentication for basic scanning.

### Snyk

Set environment variables:
- SNYK_TOKEN: Your Snyk API token
- SNYK_ORG: Snyk organization ID (optional)

Get token: https://app.snyk.io/account

## Output Formats

- **text**: Human-readable console output
- **json**: Machine-readable JSON
- **sarif**: SARIF format for IDE integration

## Best Practices

1. Run `/security scan` before every PR
2. Run `/security deps` weekly or in CI
3. Run `/security secrets` before commits
4. Run `/security compliance` quarterly
