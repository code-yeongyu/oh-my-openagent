import type { SecretPattern } from "./types";

export const DEFAULT_SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "AWS Access Key ID",
    pattern: /AKIA[A-Z0-9]{16}/g,
    severity: "critical",
    description: "AWS Access Key ID",
  },
  {
    name: "AWS Secret Access Key",
    pattern: /[A-Za-z0-9/+=]{40}(?=\s|$|"|')/g,
    severity: "critical",
    description: "Potential AWS Secret Access Key (40 char base64)",
  },
  {
    name: "JWT Token",
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    severity: "high",
    description: "JSON Web Token",
  },
  {
    name: "OpenAI API Key",
    pattern: /sk-[A-Za-z0-9]{48,}/g,
    severity: "critical",
    description: "OpenAI API Key",
  },
  {
    name: "GitHub Token",
    pattern: /gh[ps]_[A-Za-z0-9]{36,}/g,
    severity: "critical",
    description: "GitHub Personal Access Token or App Token",
  },
  {
    name: "GitHub OAuth Token",
    pattern: /gho_[A-Za-z0-9]{36,}/g,
    severity: "critical",
    description: "GitHub OAuth Token",
  },
  {
    name: "Anthropic API Key",
    pattern: /sk-ant-[A-Za-z0-9-]{90,}/g,
    severity: "critical",
    description: "Anthropic API Key",
  },
  {
    name: "Google API Key",
    pattern: /AIza[A-Za-z0-9_-]{35}/g,
    severity: "high",
    description: "Google API Key",
  },
  {
    name: "Stripe API Key",
    pattern: /sk_live_[A-Za-z0-9]{24,}/g,
    severity: "critical",
    description: "Stripe Live API Key",
  },
  {
    name: "Stripe Test Key",
    pattern: /sk_test_[A-Za-z0-9]{24,}/g,
    severity: "medium",
    description: "Stripe Test API Key",
  },
  {
    name: "Slack Token",
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    severity: "high",
    description: "Slack API Token",
  },
  {
    name: "Private Key Header",
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    severity: "critical",
    description: "Private Key (RSA/SSH/etc)",
  },
  {
    name: "Generic API Key Assignment",
    pattern: /(api[_-]?key|apikey|secret[_-]?key|access[_-]?token)["'\s]*[:=]["'\s]*["'][A-Za-z0-9_-]{20,}["']/gi,
    severity: "high",
    description: "Generic API key or secret assignment",
  },
  {
    name: "Database Connection String",
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
    severity: "critical",
    description: "Database connection string with credentials",
  },
  {
    name: "Bearer Token",
    pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/g,
    severity: "high",
    description: "Bearer authentication token",
  },
];

export function getAllPatterns(customPatterns: SecretPattern[] = []): SecretPattern[] {
  return [...DEFAULT_SECRET_PATTERNS, ...customPatterns];
}
