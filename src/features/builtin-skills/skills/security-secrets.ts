import type { BuiltinSkill } from "../types"

export const SECURITY_SECRETS_SKILL_NAME = "security-secrets"

const SECURITY_SECRETS_SKILL_DESCRIPTION =
  "Secret scanning, entropy analysis, gitleaks usage, and remediation playbooks for exposed credentials. Triggers: 'secret', 'API key', 'credential', 'gitleaks', 'secret scanning', 'key exposure'."

export const securitySecretsSkill: BuiltinSkill = {
  name: SECURITY_SECRETS_SKILL_NAME,
  description: SECURITY_SECRETS_SKILL_DESCRIPTION,
  template: `# Security Secrets — Credential Scanning & Remediation

## GITLEAKS CLI COMMANDS

Use these commands to scan for secrets using Gitleaks:

- **Scan staged changes (Pre-commit)**:
  \`gitleaks detect --staged --report-format json --no-banner\`
- **Scan entire repository (Local)**:
  \`gitleaks detect --source . --report-format json\`
- **Scan specific commit range (CI/CD)**:
  \`gitleaks detect --log-opts="origin/dev..HEAD" --report-format json\`

## GITLEAKS JSON OUTPUT FORMAT

Gitleaks outputs an array of JSON objects. Key fields to analyze:
- \`RuleID\`: The specific rule that triggered the match (e.g., \`aws-access-token\`).
- \`Match\`: The actual secret string that was found.
- \`File\`: The file path where the secret is located.
- \`StartLine\` / \`EndLine\`: The line numbers containing the secret.
- \`Description\`: Human-readable explanation of the finding.

## COMMON SECRET PATTERNS

Manually look for these patterns if automated tools fail:
- **AWS Keys**: \`AKIA[0-9A-Z]{16}\`
- **GitHub Tokens**: \`ghp_[a-zA-Z0-9]{36}\`, \`gho_[a-zA-Z0-9]{36}\`, \`ghs_[a-zA-Z0-9]{36}\`
- **Private Keys**: \`-----BEGIN RSA PRIVATE KEY-----\`, \`-----BEGIN OPENSSH PRIVATE KEY-----\`
- **JWT Tokens**: \`eyJ[a-zA-Z0-9_-]*.[a-zA-Z0-9_-]*.[a-zA-Z0-9_-]*\`
- **Database Connection Strings**: \`postgres://user:pass@host:port/db\`, \`mongodb+srv://...\`
- **API Keys**: High entropy strings assigned to variables like \`API_KEY\`, \`SECRET\`, \`TOKEN\`, \`PASSWORD\`.

## ENTROPY ANALYSIS

Entropy measures the randomness of a string. High entropy often indicates a cryptographic key or secret.
- **High Entropy**: > 4.5 Shannon bits per character (e.g., \`z4x9Q!p@L2w#v8M\`).
- **Base64 Detection**: Strings matching \`^[a-zA-Z0-9+/]+={0,2}$\` with high entropy.
- **Hex Detection**: Strings matching \`^[a-fA-F0-9]+$\` with high entropy (e.g., SHA hashes, API keys).

## .GITLEAKS.TOML ALLOWLIST CONFIGURATION

To reduce false positives, configure \`.gitleaks.toml\`:
\`\`\`toml
[allowlist]
description = "Ignore test files and dummy secrets"
paths = [
    '''tests/.*''',
    '''mocks/.*'''
]
regexes = [
    '''dummy_secret_for_testing''',
    '''EXAMPLE_KEY_123'''
]
\`\`\`

## REMEDIATION PLAYBOOK

If a secret is exposed, follow these steps IMMEDIATELY:
1. **Rotate Compromised Credentials**: Invalidate the exposed key in the provider's dashboard. A leaked key is a compromised key.
2. **Use Environment Variables**: Replace hardcoded secrets with \`process.env.SECRET_NAME\` or equivalent.
3. **Use Secret Managers**: Migrate to robust solutions like AWS Secrets Manager, HashiCorp Vault, or 1Password.
4. **Update .gitignore**: Ensure sensitive files (e.g., \`.env\`, \`*.pem\`) are ignored.
5. **Purge Git History**: Use \`git filter-branch\` or BFG Repo-Cleaner to remove the secret from all historical commits. (Do NOT just add a new commit deleting the secret).

## ENVSITTER INTEGRATION

When working with \`.env\` files, NEVER read or print them directly. Use the EnvSitter tools to safely interact with secrets:
- \`envsitter_keys\`: List keys without exposing values.
- \`envsitter_scan\`: Detect shapes (jwt, url, base64) without printing values.
- \`envsitter_match\`: Check if a key exists or matches a pattern safely.
`,
}
