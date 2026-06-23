import type { BuiltinSkill } from "../types"

export const SECURITY_DEPENDENCIES_SKILL_NAME = "security-dependencies"

const SECURITY_DEPENDENCIES_SKILL_DESCRIPTION =
  "Dependency security scanning, SBOM generation, CVE lookups, remediation strategies, license compliance, and supply chain risk management. Triggers: 'dependency', 'CVE', 'npm audit', 'trivy', 'supply chain', 'vulnerability scanning', 'SBOM', 'license'."

export const securityDependenciesSkill: BuiltinSkill = {
  name: SECURITY_DEPENDENCIES_SKILL_NAME,
  description: SECURITY_DEPENDENCIES_SKILL_DESCRIPTION,
  template: `# Security — Dependency & Supply Chain Management

## TRIVY FILESYSTEM SCAN
- **Basic Vulnerability Scan**: \`trivy fs --format json --scanners vuln .\`
- **High/Critical Severity Scan**: \`trivy fs --format json --severity CRITICAL,HIGH .\`
- **SARIF Output (for CI/CD)**: \`trivy fs --format sarif .\`

### Trivy JSON Output Structure
- \`Results\`: Array of scan targets (e.g., \`package-lock.json\`).
  - \`Target\`: The file or artifact scanned.
  - \`Vulnerabilities\`: Array of findings.
    - \`VulnerabilityID\`: The CVE or advisory ID.
    - \`PkgName\`: Name of the vulnerable package.
    - \`InstalledVersion\`: Currently installed version.
    - \`FixedVersion\`: Version where the issue is resolved.
    - \`Severity\`: Risk level (e.g., HIGH, CRITICAL).
    - \`Title\` & \`Description\`: Summary and details of the vulnerability.

## NPM & BUN AUDIT
- **npm audit**: \`npm audit --json\` to get structured vulnerability data.
- **npm audit fix**: \`npm audit fix --dry-run\` to safely preview automatic remediations.
- **Severity Levels**: Info, Low, Moderate, High, Critical.
- **Advisories Structure**: Contains details about the vulnerable package, patched versions, and dependency paths.
- **Bun audit**: \`bun pm audit\` (if available in project) for fast dependency auditing in Bun environments.

## OSV-SCANNER
- **Directory Scan**: \`osv-scanner --format json .\`
- **Lockfile Scan**: \`osv-scanner --lockfile=package-lock.json --format json\`
- **Output Structure**: Includes \`Source\` (file), \`Package\` (name/ecosystem), \`Version\`, \`Ecosystem\`, \`CVSS\` (score), and \`FixedVersion\`.

## SBOM GENERATION
- **Software Bill of Materials**: \`trivy fs --format spdx-json .\` generates a standardized inventory of all components, libraries, and dependencies used in the project.

## CVE DATABASE LOOKUPS
- **CVE IDs**: Format is \`CVE-YYYY-NNNNN\` (e.g., CVE-2021-44228).
- **CVSS Scoring**: Common Vulnerability Scoring System, ranges from 0.0 to 10.0 (Critical is 9.0-10.0).
- **NVD References**: National Vulnerability Database provides official metrics, descriptions, and reference links for CVEs.

## REMEDIATION STRATEGIES
- **Upgrade**: Update to the patched version (preferred).
- **Alternative Package**: Switch to a secure, maintained alternative if the current package is abandoned.
- **Workaround**: Apply configuration changes or code-level mitigations if a patch is unavailable.
- **Accept Risk**: Document and accept the risk with justification if the vulnerability is unreachable in your specific context.

## LICENSE COMPLIANCE
- **Problematic Licenses**: Identifying restrictive licenses (e.g., GPL in proprietary closed-source projects, AGPL in SaaS environments).
- **License Compatibility Matrix**: Ensuring dependencies' licenses are compatible with the project's distribution model.

## SUPPLY CHAIN RISKS
- **Typosquatting**: Malicious packages with names similar to popular ones (e.g., \`react-dom\` vs \`react-don\`).
- **Dependency Confusion**: Forcing a build system to pull a malicious public package instead of a private internal one.
- **Maintainer Account Compromise**: Attackers taking over legitimate maintainer accounts to publish malicious updates.
- **Star-Jacking**: Malicious packages linking to popular GitHub repositories to appear legitimate.

## LOCKFILE INTEGRITY
- **Verification**: Ensuring \`package-lock.json\`, \`yarn.lock\`, or \`bun.lockb\` integrity.
- **Unauthorized Changes**: Detecting unexpected modifications to lockfiles that might introduce malicious sub-dependencies.
`,
}
