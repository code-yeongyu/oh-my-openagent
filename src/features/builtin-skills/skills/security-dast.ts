import type { BuiltinSkill } from "../types"

export const SECURITY_DAST_SKILL_NAME = "security-dast"

const SECURITY_DAST_SKILL_DESCRIPTION =
  "DAST overview: testing running applications for vulnerabilities at runtime, differs from SAST by finding issues only visible during execution. Triggers: 'DAST', 'dynamic analysis', 'ZAP', 'Nuclei', 'runtime security', 'penetration test', 'fuzzing'."

export const securityDastSkill: BuiltinSkill = {
  name: SECURITY_DAST_SKILL_NAME,
  description: SECURITY_DAST_SKILL_DESCRIPTION,
  template: `# Security — Dynamic Application Security Testing (DAST)

## DAST OVERVIEW
- **Definition**: Testing running applications for vulnerabilities at runtime.
- **DAST vs SAST**: DAST finds runtime issues (auth bypass, CORS, header misconfig) by interacting with the application from the outside. SAST finds code-level issues (injection, XSS patterns) by analyzing source code without executing it.

## OWASP ZAP CLI
- **Quick Scan**: \`zap-cli quick-scan --self-contained --start-options '-config api.disablekey=true' <url>\`
- **Active Scan**: \`zap-cli active-scan <url>\`
- **View Alerts**: \`zap-cli alerts -l High\`
- **JSON Report Generation**: \`zap-cli report -o report.json -f json\`

## NUCLEI CLI
- **Scan for CVEs**: \`nuclei -u <url> -t cves/ -json\`
- **Scan for Exposures**: \`nuclei -u <url> -t exposures/ -json\`
- **Scan for High/Critical Vulnerabilities**: \`nuclei -u <url> -t vulnerabilities/ -severity critical,high -json\`
- **Scan Multiple URLs for Misconfigurations**: \`nuclei -l urls.txt -t http/misconfiguration/ -json\`

### Nuclei JSON Output Structure
- \`template-id\`: Identifier for the matched template
- \`info\`: Metadata including \`name\`, \`severity\`, and \`tags\`
- \`matched-at\`: The specific URL or endpoint where the vulnerability was found
- \`curl-command\`: Command to reproduce the finding

## HTTP FUZZING PATTERNS
- **Parameter Tampering**: Modifying URL parameters, form fields, or JSON body values to test for unhandled input.
- **Header Injection**: Injecting malicious payloads into HTTP headers (e.g., Host, User-Agent, X-Forwarded-For).
- **Cookie Manipulation**: Altering session cookies or state tokens to test for privilege escalation or session hijacking.
- **Method Switching**: Changing HTTP methods (GET→POST→PUT→DELETE) to bypass access controls or trigger unexpected behavior.

## RUNTIME VULNERABILITY DETECTION
- **Open Redirects**: Testing if parameters used for redirection can be manipulated to point to external malicious sites.
- **CORS Misconfiguration**: Checking if \`Access-Control-Allow-Origin\` is overly permissive (e.g., \`*\` with credentials).
- **Clickjacking**: Verifying the presence and correctness of \`X-Frame-Options\` or CSP \`frame-ancestors\`.
- **Missing Security Headers**: Ensuring headers like \`Content-Security-Policy\` (CSP), \`Strict-Transport-Security\` (HSTS), and \`X-Content-Type-Options\` are properly configured.

## API ENDPOINT DISCOVERY AND TESTING
- **Directory Brute-Forcing**: Discovering hidden paths and administrative interfaces.
- **Parameter Enumeration**: Finding undocumented parameters that might expose sensitive functionality.
- **Authentication Bypass Attempts**: Testing endpoints without tokens, with expired tokens, or with tokens from different users.

## WEB CRAWLING FOR SECURITY
- **Sitemap Analysis**: Extracting structure and endpoints from \`robots.txt\` and \`sitemap.xml\`.
- **JavaScript Endpoint Extraction**: Parsing JS files to find hardcoded API routes and hidden parameters.
- **Hidden Parameter Discovery**: Identifying parameters used in client-side logic but not explicitly exposed in the UI.

## INTEGRATION WITH CI/CD
- **Staging Environments**: Running DAST scans against staging or pre-production environments to catch runtime issues before deployment.
- **Baseline Scan vs Full Scan**: Using baseline scans (passive) for quick feedback in CI pipelines, and full active scans for comprehensive testing during nightly builds or dedicated security stages.
`,
}
