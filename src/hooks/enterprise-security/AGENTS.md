# Enterprise Security Hook

Comprehensive security and compliance hook that protects sensitive files, detects hardcoded credentials, validates PII exposure, and blocks dangerous bash commands.

## Features

### 1. File Protection
Blocks read/write/edit access to sensitive files:
- Environment files (`.env`, `.env.*`)
- SSH keys (`.ssh/*`, `*.pem`, `*.key`)
- AWS credentials (`.aws/credentials`)
- Secrets directories (`secrets/*`, `.secrets/*`)
- Git credentials (`.git-credentials`)
- API keys (`api-keys.*`, `.npmrc`)
- Docker/Kubernetes secrets
- Terraform state files (`*.tfstate`, `terraform.tfvars`)
- Service account credentials (`credentials.json`, `service-account.json`)

**Allowed paths** (exempt from protection):
- `.claude/*` - Claude Code configuration
- `.config/opencode/*` - OpenCode configuration
- `.opencode/*` - Project OpenCode configuration

### 2. Compliance Check (GDPR, SOC2, HIPAA)
Scans file content for:
- **PII (Personally Identifiable Information)**:
  - Social Security Numbers (SSN)
  - Credit card numbers
  - Phone numbers
  - IP addresses
  - Email addresses with passwords
- **Hardcoded Credentials**:
  - API keys
  - Passwords
  - Tokens
  - AWS access keys
  - Private keys
- **Insecure Logging**:
  - Sensitive data in console.log/print statements

**Behavior**:
- **Errors**: Blocks operation completely (hardcoded credentials)
- **Warnings**: Allows operation but warns user (PII, insecure logging)

### 3. Bash Command Validation
Blocks dangerous bash commands:
- `rm -rf /` (except `/tmp`)
- Fork bombs `:(){ :|:& };:`
- Disk wipe commands (`dd if=/dev/zero`)
- Filesystem formatting (`mkfs.*`)
- Direct disk writes (`> /dev/sd*`)
- Dangerous chmod (`chmod -R 777 /`)
- Curl/wget piped to bash/sh (`curl ... | bash`)

**Warnings** (not blocked):
- Database exports without encryption
- HTTP requests with passwords in command line

## Usage

The hook is **enabled by default**. No configuration required.

### Disable
```jsonc
{
  "disabled_hooks": ["enterprise-security"]
}
```

### Override Protection (Development Only)
If you need to access protected files for legitimate reasons:
1. Add the file path to `ALLOWED_PATHS` in `constants.ts`
2. Or temporarily disable the hook with `disabled_hooks`

## Examples

### Protected File Access (Blocked)
```typescript
// Read tool on .env file
{
  tool: "Read",
  args: { filePath: ".env" }
}
// Result: BLOCKED
// Message: "SECURITY: Access to protected file denied. File: .env. Reason: Pattern match: .env"
```

### Hardcoded Credential (Blocked)
```typescript
// Write tool with hardcoded password
{
  tool: "Write",
  args: {
    filePath: "config.ts",
    content: 'const password = "mySecretPassword123"'
  }
}
// Result: BLOCKED
// Message: "COMPLIANCE WARNING: Potential security issues detected.
// ERRORS (must fix):
//   - Hardcoded Credential: password\\s*=\\s*[\"'][^\"']{4,}[\"']"
```

### PII Detection (Warning)
```typescript
// Write tool with SSN
{
  tool: "Write",
  args: {
    filePath: "user.ts",
    content: 'const ssn = "123-45-6789"'
  }
}
// Result: ALLOWED (with warning)
// Warning: "COMPLIANCE WARNING: Potential security issues detected.
// WARNINGS (review recommended):
//   - PII"
```

### Dangerous Bash Command (Blocked)
```typescript
// Bash tool with rm -rf /
{
  tool: "Bash",
  args: { command: "rm -rf /" }
}
// Result: BLOCKED
// Message: "SECURITY: Dangerous bash command blocked.
// Command: rm -rf /
// Reason: Dangerous command pattern detected: rm\\s+-rf\\s+\\/(?!tmp|var\\/tmp)"
```

## Compliance Standards

This hook helps meet requirements for:
- **GDPR**: PII detection and protection
- **SOC2**: Access control and audit logging
- **HIPAA**: PHI protection
- **PCI DSS**: Credit card data protection

## Implementation Details

### File Protection (`utils.ts:isProtectedFile`)
Uses `minimatch` for glob pattern matching against `PROTECTED_FILE_PATTERNS`.

### Compliance Check (`utils.ts:checkComplianceViolations`)
Uses regex patterns to detect PII and credentials in file content.

### Bash Validation (`utils.ts:checkDangerousBashCommand`)
Uses regex patterns to detect dangerous command patterns.

### Hook Points
- **`tool.execute.before`**: File protection, compliance check, bash validation (blocking)
- **`tool.execute.after`**: Tool output scanning for sensitive data (warning only)

## Patterns

All patterns are configurable in `constants.ts`:
- `PROTECTED_FILE_PATTERNS`: File glob patterns
- `BLOCKED_PATHS`: Absolute paths always blocked
- `ALLOWED_PATHS`: Paths exempt from protection
- `PII_PATTERNS`: Regex patterns for PII detection
- `CREDENTIAL_PATTERNS`: Regex patterns for credentials
- `INSECURE_LOGGING_PATTERNS`: Regex patterns for insecure logging
- `DANGEROUS_BASH_PATTERNS`: Regex patterns for dangerous commands

## Testing

Test the hook with:
```bash
bun test src/hooks/enterprise-security/
```

## FAQ

**Q: Why is my `.env` file blocked?**
A: Environment files contain secrets. Use environment variables or secure vaults instead.

**Q: I need to read credentials for migration. How?**
A: Temporarily disable the hook with `disabled_hooks: ["enterprise-security"]` or add path to `ALLOWED_PATHS`.

**Q: False positive on PII detection?**
A: PII patterns are heuristic. Review the warning and ensure no real PII is present.

**Q: How do I add custom patterns?**
A: Edit `constants.ts` and add your patterns to the appropriate array.

## Contributing

When adding new patterns:
1. Add to `constants.ts` with clear comment explaining what it detects
2. Update this AGENTS.md documentation
3. Add test cases to verify detection
4. Consider false positive rate
