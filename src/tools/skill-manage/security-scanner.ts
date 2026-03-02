const HARD_BLOCK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, reason: "Detected private key material" },
  { pattern: /AKIA[0-9A-Z]{16}/, reason: "Detected AWS access key format" },
  { pattern: /"type"\s*:\s*"service_account"/, reason: "Detected GCP service account JSON" },
  { pattern: /DefaultEndpointsProtocol=https;AccountName=/, reason: "Detected Azure connection string format" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, reason: "Detected GitHub personal access token format" },
  { pattern: /sk-[a-zA-Z0-9]{48}/, reason: "Detected OpenAI API key format" },
  {
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{20,}["']/i,
    reason: "Detected high-entropy secret assignment pattern",
  },
]

const WARNING_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\beval\s*\(/i, warning: "Contains eval() usage" },
  { pattern: /\bexec\s*\(/i, warning: "Contains exec() usage" },
  { pattern: /\bsubprocess\b|\bos\.system\b|shell\s*=\s*true/i, warning: "Contains shell execution pattern" },
  { pattern: /\$\{[^}]+\}|\$\([^)]+\)/, warning: "Contains shell expansion pattern (${...} or $(...))" },
  { pattern: /https?:\/\//i, warning: "Contains external URL reference" },
]

export interface SecurityScanResult {
  blockedReasons: string[]
  warnings: string[]
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function scanSkillContent(content: string): SecurityScanResult {
  const blockedReasons = unique(
    HARD_BLOCK_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(({ reason }) => reason)
  )

  const warnings = unique(
    WARNING_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(({ warning }) => warning)
  )

  return { blockedReasons, warnings }
}
