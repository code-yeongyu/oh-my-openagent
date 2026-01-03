export interface SecuritySkillConfig {
  semgrep?: {
    appToken?: string
    deployment?: string
  }
  snyk?: {
    token?: string
    org?: string
  }
}

export type SecurityCommand = "scan" | "audit" | "secrets" | "compliance" | "deps"

export type SecuritySeverity = "low" | "medium" | "high" | "critical"

export interface SecurityScanOptions {
  paths?: string[]
  severity?: SecuritySeverity
  rules?: string[]
  exclude?: string[]
}

export interface SecurityAuditOptions {
  target?: "code" | "deps" | "secrets" | "all"
  format?: "json" | "sarif" | "text"
}

export interface SecuritySecretsOptions {
  paths?: string[]
  verify?: boolean
}

export interface SecurityComplianceOptions {
  framework?: "soc2" | "pci" | "hipaa" | "gdpr"
  scope?: string[]
}

export interface SecurityDepsOptions {
  lockfile?: string
  dev?: boolean
  severity?: SecuritySeverity
}
