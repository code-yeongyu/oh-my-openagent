export interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  description: string;
}

export interface SecurityScannerConfig {
  enabled: boolean;
  patterns: SecretPattern[];
  allowListPatterns: string[];
  scanOnWrite: boolean;
  scanOnEdit: boolean;
  maskInOutput: boolean;
}

export interface SecretMatch {
  pattern: string;
  patternName: string;
  line: number;
  column: number;
  preview: string;
  severity: "critical" | "high" | "medium";
  filePath?: string;
}

export interface ScanResult {
  hasSecrets: boolean;
  matches: SecretMatch[];
  scannedContent: string;
  scanDurationMs: number;
}
