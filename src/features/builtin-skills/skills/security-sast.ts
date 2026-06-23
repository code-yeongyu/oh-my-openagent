import type { BuiltinSkill } from "../types"

export const SECURITY_SAST_SKILL_NAME = "security-sast"

const SECURITY_SAST_SKILL_DESCRIPTION =
  "Static Application Security Testing (SAST), Semgrep usage, CWE-specific code patterns, and ESLint security plugins. Triggers: 'SAST', 'static analysis', 'semgrep', 'code scanning', 'vulnerability pattern'."

export const securitySastSkill: BuiltinSkill = {
  name: SECURITY_SAST_SKILL_NAME,
  description: SECURITY_SAST_SKILL_DESCRIPTION,
  template: `# Security SAST — Static Application Security Testing

## SEMGREP CLI COMMANDS

Use Semgrep for fast, pattern-based static analysis:

- **Auto-detect languages and scan**:
  \`semgrep scan --config auto --json --quiet\`
- **Scan specifically for OWASP Top 10**:
  \`semgrep scan --config p/owasp-top-ten --json\`
- **Scan with JavaScript/TypeScript specific rules**:
  \`semgrep scan --config p/javascript --json\`

## SEMGREP JSON OUTPUT STRUCTURE

Semgrep JSON output contains a \`results\` array. Key fields:
- \`check_id\`: The rule identifier (e.g., \`javascript.express.security.injection.tainted-sql-string\`).
- \`path\`: The file path where the vulnerability was found.
- \`start\` / \`end\`: Line and column numbers.
- \`extra.message\`: Detailed explanation of the vulnerability.
- \`extra.severity\`: Severity level (ERROR, WARNING, INFO).
- \`extra.metadata\`: Additional context, often including CWE IDs and OWASP categories.

## CWE-SPECIFIC CODE PATTERNS TO DETECT MANUALLY

When automated tools are unavailable, manually review code for these dangerous patterns:

* **CWE-79 XSS (Cross-Site Scripting)**:
  - \`innerHTML\`, \`outerHTML\` assignments.
  - React: \`dangerouslySetInnerHTML={{ __html: userInput }}\`.
  - \`document.write()\`.
  - Unsanitized template literals in HTML contexts.

* **CWE-89 SQL Injection**:
  - String concatenation in SQL queries: \`"SELECT * FROM users WHERE id = " + req.body.id\`.
  - Template literals in queries: \`\\\`SELECT * FROM users WHERE id = \${id}\\\`\`.
  - Missing parameterized queries or ORM usage.

* **CWE-22 Path Traversal**:
  - User input directly in file paths: \`fs.readFile(req.query.file)\`.
  - Missing \`path.normalize()\` or \`path.resolve()\`.
  - Failure to check for \`../..\` sequences.

* **CWE-78 Command Injection**:
  - \`exec()\`, \`spawn()\`, or \`execSync()\` with unsanitized user input.
  - \`child_process\` usage without strict argument separation.

* **CWE-502 Insecure Deserialization**:
  - \`JSON.parse()\` on untrusted input without schema validation.
  - \`eval()\` or \`new Function()\` with user-controlled strings.
  - Unsafe YAML or XML parsing.

* **CWE-918 SSRF (Server-Side Request Forgery)**:
  - User-controlled URLs passed directly to \`fetch()\`, \`axios\`, or \`http.get()\`.
  - Missing validation of internal IP ranges (e.g., \`169.254.169.254\`, \`127.0.0.1\`).

* **CWE-327 Broken Crypto**:
  - Using MD5 or SHA1 for password hashing.
  - Using \`Math.random()\` for security-sensitive random values (use \`crypto.randomBytes\` instead).
  - Weak cipher modes (e.g., ECB instead of GCM/CBC).

* **CWE-611 XXE (XML External Entities)**:
  - XML parsing without explicitly disabling external entity resolution.

## ESLINT SECURITY PLUGINS

Recommend and configure these plugins for continuous security linting:
- **\`eslint-plugin-security\`**: Detects unsafe regex, \`eval\`, and \`child_process\` usage.
- **\`eslint-plugin-no-unsanitized\`**: Prevents DOM XSS by blocking unsafe assignments to \`innerHTML\` and similar sinks.

## INTERPRETING SARIF OUTPUT FORMAT

SARIF (Static Analysis Results Interchange Format) is the standard for SAST tools.
- **\`runs[].results\`**: Contains the actual findings.
- **\`ruleId\`**: Maps to the specific vulnerability rule.
- **\`level\`**: \`error\`, \`warning\`, or \`note\`.
- **\`locations\`**: Specifies the physical file and line numbers.
- **\`message.text\`**: The human-readable description.
`,
}
