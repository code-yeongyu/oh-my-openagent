/**
 * Enterprise Security Hook Constants
 * Patterns for protected files, blocked commands, and compliance checks
 */

// Protected file patterns (glob patterns)
export const PROTECTED_FILE_PATTERNS = [
	// Environment files
	".env",
	".env.*",
	".env.local",
	".env.production",
	".env.development",
	"*.env",

	// AWS credentials
	".aws/credentials",
	".aws/config",

	// SSH keys
	".ssh/id_*",
	".ssh/known_hosts",
	"*_rsa",
	"*_ed25519",
	"*.pem",
	"*.key",

	// Secrets directories
	"secrets/*.json",
	"secrets/*.yaml",
	"secrets/*.yml",
	".secrets/*.json",
	".secrets/*.yaml",

	// Git credentials
	".git-credentials",

	// NPM tokens
	".npmrc",

	// Docker secrets
	".docker/config.json",

	// Kubernetes secrets
	"k8s/secrets/*.yaml",
	"k8s/secrets/*.yml",
	"kubernetes/secrets/*.yaml",
	"kubernetes/secrets/*.yml",

	// Terraform state (contains secrets)
	"*.tfstate",
	"*.tfstate.backup",
	"terraform.tfvars",
	"*.auto.tfvars",

	// Database configs with passwords
	"credentials.json",
	"service-account.json",
	"gcp-credentials.json",
	"firebase-adminsdk*.json",

	// API keys files
	"api-keys.json",
	"api-keys.yaml",
	".api-keys",
];

// Paths that are always blocked (exact match)
export const BLOCKED_PATHS = [
	"/etc/passwd",
	"/etc/shadow",
	"/etc/sudoers",
	"~/.bash_history",
	"~/.zsh_history",
];

// Paths to ALLOW even if they might match patterns
export const ALLOWED_PATHS = [
	".claude/settings.json",
	".claude/agents/",
	".claude/skills/",
	".claude/hooks/",
	".claude/commands/",
	".claude/templates/",
	".claude/teams/",
	".config/opencode/",
	".opencode/",
];

// PII patterns (Personally Identifiable Information)
export const PII_PATTERNS = [
	// SSN (Social Security Number)
	/\b\d{3}-\d{2}-\d{4}\b/,
	// Credit Card
	/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,
	// Email with password in same line
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b.*password/i,
	// Phone US
	/\b\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/,
	// IP Address (can be PII in GDPR context)
	/\b(?:\d{1,3}\.){3}\d{1,3}\b/,
];

// Hardcoded credentials patterns
export const CREDENTIAL_PATTERNS = [
	/password\s*=\s*["'][^"']{4,}["']/i,
	/api[_-]?key\s*=\s*["'][^"']{8,}["']/i,
	/secret\s*=\s*["'][^"']{8,}["']/i,
	/token\s*=\s*["'][^"']{16,}["']/i,
	/private[_-]?key\s*=\s*["']/i,
	/AWS[_-]?ACCESS[_-]?KEY[_-]?ID\s*=\s*["']?AKI/i,
	/AKIA[0-9A-Z]{16}/,
];

// Insecure logging patterns
export const INSECURE_LOGGING_PATTERNS = [
	/console\.log.*password/i,
	/console\.log.*token/i,
	/console\.log.*secret/i,
	/console\.log.*key/i,
	/print.*password/i,
	/logger\..*password/i,
];

// Dangerous bash commands
export const DANGEROUS_BASH_PATTERNS = [
	/rm\s+-rf\s+\/(?!tmp|var\/tmp)/i, // rm -rf / (except /tmp)
	/:\(\)\{\s*:\|:&\s*\};:/, // Fork bomb
	/dd\s+if=\/dev\/zero/i, // Disk wipe
	/mkfs\./i, // Format filesystem
	/> \/dev\/sd[a-z]/i, // Direct disk write
	/chmod\s+-R\s+777\s+\//i, // Chmod 777 on root
	/curl.*\|\s*bash/i, // Curl | bash (potential security risk)
	/wget.*\|\s*sh/i, // Wget | sh (potential security risk)
];
