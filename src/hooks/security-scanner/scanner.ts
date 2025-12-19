import type { SecretPattern, SecretMatch, ScanResult } from "./types";
import { MASK_CHAR, MASK_VISIBLE_CHARS } from "./constants";
import { getAllPatterns } from "./patterns";

export function maskSecret(secret: string): string {
  if (secret.length <= MASK_VISIBLE_CHARS * 2) {
    return MASK_CHAR.repeat(secret.length);
  }
  const prefix = secret.slice(0, MASK_VISIBLE_CHARS);
  const suffix = secret.slice(-MASK_VISIBLE_CHARS);
  const masked = MASK_CHAR.repeat(Math.min(secret.length - MASK_VISIBLE_CHARS * 2, 20));
  return `${prefix}${masked}${suffix}`;
}

export function matchesAllowlist(match: string, allowListPatterns: string[]): boolean {
  for (const pattern of allowListPatterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(match)) {
        return true;
      }
    } catch {
      // Invalid regex, skip
    }
  }
  return false;
}

function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const lines = content.slice(0, index).split("\n");
  const line = lines.length;
  const column = (lines[lines.length - 1]?.length ?? 0) + 1;
  return { line, column };
}

function createPreview(content: string, matchStart: number, matchEnd: number): string {
  const lineStart = content.lastIndexOf("\n", matchStart) + 1;
  const lineEnd = content.indexOf("\n", matchEnd);
  const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  
  const matchInLine = content.slice(matchStart, matchEnd);
  const maskedLine = line.replace(matchInLine, maskSecret(matchInLine));
  
  const maxLen = 80;
  if (maskedLine.length > maxLen) {
    const matchPos = maskedLine.indexOf(maskSecret(matchInLine));
    const start = Math.max(0, matchPos - 20);
    const end = Math.min(maskedLine.length, matchPos + 60);
    return (start > 0 ? "..." : "") + maskedLine.slice(start, end) + (end < maskedLine.length ? "..." : "");
  }
  return maskedLine;
}

export function scanContent(
  content: string,
  patterns: SecretPattern[] = getAllPatterns(),
  allowListPatterns: string[] = []
): ScanResult {
  const startTime = performance.now();
  const matches: SecretMatch[] = [];

  for (const patternDef of patterns) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const matchedText = match[0];
      
      if (matchesAllowlist(matchedText, allowListPatterns)) {
        continue;
      }

      const { line, column } = getLineAndColumn(content, match.index);
      const preview = createPreview(content, match.index, match.index + matchedText.length);

      matches.push({
        pattern: patternDef.pattern.source,
        patternName: patternDef.name,
        line,
        column,
        preview,
        severity: patternDef.severity,
      });
    }
  }

  return {
    hasSecrets: matches.length > 0,
    matches,
    scannedContent: content,
    scanDurationMs: performance.now() - startTime,
  };
}

export function formatScanResult(result: ScanResult, filePath?: string): string {
  if (!result.hasSecrets) {
    return "";
  }

  const lines: string[] = [
    "🔐 SECURITY ALERT: Potential secrets detected!",
    "",
  ];

  if (filePath) {
    lines.push(`File: ${filePath}`);
    lines.push("");
  }

  const bySeverity = {
    critical: result.matches.filter((m) => m.severity === "critical"),
    high: result.matches.filter((m) => m.severity === "high"),
    medium: result.matches.filter((m) => m.severity === "medium"),
  };

  if (bySeverity.critical.length > 0) {
    lines.push("🚨 CRITICAL:");
    for (const match of bySeverity.critical) {
      lines.push(`  Line ${match.line}: ${match.patternName}`);
      lines.push(`    ${match.preview}`);
    }
    lines.push("");
  }

  if (bySeverity.high.length > 0) {
    lines.push("⚠️ HIGH:");
    for (const match of bySeverity.high) {
      lines.push(`  Line ${match.line}: ${match.patternName}`);
      lines.push(`    ${match.preview}`);
    }
    lines.push("");
  }

  if (bySeverity.medium.length > 0) {
    lines.push("📋 MEDIUM:");
    for (const match of bySeverity.medium) {
      lines.push(`  Line ${match.line}: ${match.patternName}`);
      lines.push(`    ${match.preview}`);
    }
    lines.push("");
  }

  lines.push("💡 Suggestions:");
  lines.push("  - Use environment variables for secrets");
  lines.push("  - Add secrets to .gitignore");
  lines.push("  - Use a secrets manager (AWS Secrets Manager, HashiCorp Vault)");

  return lines.join("\n");
}
