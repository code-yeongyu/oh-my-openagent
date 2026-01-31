/**
 * Secret Scanner Patterns
 *
 * Regex patterns for detecting sensitive information.
 */

import type { SecretPattern, SecretScannerConfig } from "./types"

/**
 * Default configuration for secret scanner
 */
export const DEFAULT_SECRET_SCANNER_CONFIG: SecretScannerConfig = {
  enabled: true,
  whitelist_paths: [
    "**/*.test.ts",
    "**/*.test.js",
    "**/*.spec.ts",
    "**/*.spec.js",
    "**/__tests__/**",
    "**/__mocks__/**",
    "**/fixtures/**",
    "**/test/**",
    "**/tests/**",
  ],
  block_on_detection: true,
  block_severity_levels: ["high", "critical"],
}

/**
 * Patterns for detecting secrets
 * Ordered by specificity - more specific patterns first
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  {
    name: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: "critical",
    description: "AWS Access Key ID",
  },
  {
    name: "aws_secret_key",
    pattern: /\b[A-Za-z0-9/+=]{40}\b(?=.*aws|.*secret|.*key)/i,
    severity: "critical",
    description: "Potential AWS Secret Access Key",
  },

  // Azure
  {
    name: "azure_storage_key",
    pattern: /\b[A-Za-z0-9+/]{86}==\b/,
    severity: "critical",
    description: "Azure Storage Account Key",
  },
  {
    name: "azure_connection_string",
    pattern: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/i,
    severity: "critical",
    description: "Azure Storage Connection String",
  },

  // GCP
  {
    name: "gcp_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: "critical",
    description: "Google Cloud API Key",
  },
  {
    name: "gcp_service_account",
    pattern: /"type"\s*:\s*"service_account"/,
    severity: "high",
    description: "GCP Service Account JSON",
  },

  // OpenAI / Anthropic
  {
    name: "openai_api_key",
    pattern: /\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b/,
    severity: "critical",
    description: "OpenAI API Key",
  },
  {
    name: "anthropic_api_key",
    pattern: /\bsk-ant-[A-Za-z0-9-]{40,}\b/,
    severity: "critical",
    description: "Anthropic API Key",
  },

  // Generic API Keys
  {
    name: "generic_api_key",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})["']?/i,
    severity: "high",
    description: "Generic API Key",
  },
  {
    name: "generic_secret",
    pattern: /(?:secret|token|credential)\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})["']?/i,
    severity: "high",
    description: "Generic Secret/Token",
  },

  // Passwords
  {
    name: "password_assignment",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    severity: "high",
    description: "Hardcoded Password",
  },

  // Private Keys
  {
    name: "private_key",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    severity: "critical",
    description: "Private Key",
  },
  {
    name: "ssh_private_key",
    pattern: /-----BEGIN\s+(?:OPENSSH|EC)\s+PRIVATE\s+KEY-----/,
    severity: "critical",
    description: "SSH Private Key",
  },

  // Database Connection Strings
  {
    name: "database_url",
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^\s]+/i,
    severity: "high",
    description: "Database Connection String with Credentials",
  },

  // JWT
  {
    name: "jwt_token",
    pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/,
    severity: "medium",
    description: "JWT Token",
  },

  // GitHub
  {
    name: "github_token",
    pattern: /\bgh[ps]_[A-Za-z0-9]{36,}\b/,
    severity: "critical",
    description: "GitHub Personal Access Token",
  },
  {
    name: "github_oauth",
    pattern: /\bgho_[A-Za-z0-9]{36,}\b/,
    severity: "critical",
    description: "GitHub OAuth Token",
  },

  // Slack
  {
    name: "slack_token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]+\b/,
    severity: "high",
    description: "Slack Token",
  },

  // Stripe
  {
    name: "stripe_key",
    pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/,
    severity: "critical",
    description: "Stripe Live Secret Key",
  },
  {
    name: "stripe_test_key",
    pattern: /\bsk_test_[A-Za-z0-9]{24,}\b/,
    severity: "low",
    description: "Stripe Test Secret Key",
  },
]

/**
 * Patterns that indicate the content is safe (env var reference, etc.)
 */
export const SAFE_PATTERNS: RegExp[] = [
  // Environment variable references
  /process\.env\.[A-Z_]+/,
  /\$\{[A-Z_]+\}/,
  /\$[A-Z_]+/,
  /os\.environ\[/,
  /os\.getenv\(/,
  // Placeholder patterns
  /\bxxx+\b/i,
  /\byour[_-]?api[_-]?key\b/i,
  /\b<[A-Z_]+>\b/,
  /\b\[.*KEY.*\]\b/i,
]
