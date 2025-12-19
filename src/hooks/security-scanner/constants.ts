import type { SecurityScannerConfig } from "./types";

export const SECURITY_SCANNER_NAME = "security-scanner";

export const DEFAULT_SECURITY_SCANNER_CONFIG: SecurityScannerConfig = {
  enabled: true,
  patterns: [],
  allowListPatterns: [],
  scanOnWrite: true,
  scanOnEdit: true,
  maskInOutput: true,
};

export const MASK_CHAR = "*";
export const MASK_VISIBLE_CHARS = 4;
