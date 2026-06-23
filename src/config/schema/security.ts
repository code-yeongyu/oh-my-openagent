import { z } from "zod"

const DEFAULT_SENSITIVE_FILE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "service-account*.json",
  ".npmrc",
  ".pypirc",
]

const SecretScanningConfigSchema = z.object({
  /** Enable secret scanning before git commit/push (default: true) */
  enabled: z.boolean().default(true),
  /** Secret detection tool to use (default: gitleaks) */
  tool: z.enum(["gitleaks"]).default("gitleaks"),
  /** Block git operations when secrets are detected (default: true) */
  block_on_detection: z.boolean().default(true),
  /** File paths to exclude from secret scanning (glob patterns) */
  allowlist_paths: z.array(z.string()).optional(),
})

const EnvFileGuardConfigSchema = z.object({
  /** Enable guard preventing writes to sensitive files (default: true) */
  enabled: z.boolean().default(true),
  /** Glob patterns for files that should be blocked from write/edit */
  blocked_patterns: z.array(z.string()).default(DEFAULT_SENSITIVE_FILE_PATTERNS),
  /** File paths explicitly allowed despite matching blocked patterns */
  allowed_paths: z.array(z.string()).optional(),
})

const DependencyAuditConfigSchema = z.object({
  /** Enable dependency vulnerability auditing (default: false) */
  enabled: z.boolean().default(false),
  /** Automatically audit when package.json/bun.lockb changes (default: true) */
  on_package_change: z.boolean().default(true),
})

export const SecurityConfigSchema = z.object({
  /** Secret scanning configuration for pre-commit/pre-push checks */
  secret_scanning: SecretScanningConfigSchema.optional(),
  /** Guard against writing to sensitive files (.env, .pem, .key, etc.) */
  env_file_guard: EnvFileGuardConfigSchema.optional(),
  /** Dependency vulnerability auditing configuration */
  dependency_audit: DependencyAuditConfigSchema.optional(),
})

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>
export type SecretScanningConfig = z.infer<typeof SecretScanningConfigSchema>
export type EnvFileGuardConfig = z.infer<typeof EnvFileGuardConfigSchema>
export type DependencyAuditConfig = z.infer<typeof DependencyAuditConfigSchema>
