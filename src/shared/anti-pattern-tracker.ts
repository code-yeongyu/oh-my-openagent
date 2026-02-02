import { existsSync, writeFileSync, readFileSync } from "node:fs";

export interface FailedPattern {
  pattern: string;
  reason: string;
  timestamp: number;
  count: number;
}

export class AntiPatternTracker {
  private patterns: Map<string, FailedPattern> = new Map();

  constructor(private storagePath?: string) {
    this.load();
  }

  trackFailure(pattern: string, reason: string): void {
    const existing = this.patterns.get(pattern);
    if (existing) {
      existing.count += 1;
      existing.timestamp = Date.now();
      existing.reason = reason;
    } else {
      this.patterns.set(pattern, {
        pattern,
        reason,
        timestamp: Date.now(),
        count: 1,
      });
    }
    this.save();
  }

  getFailedPatterns(): FailedPattern[] {
    return Array.from(this.patterns.values());
  }

  isKnownFailure(pattern: string): boolean {
    return this.patterns.has(pattern);
  }

  clear(): void {
    this.patterns.clear();
    this.save();
  }

  private load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) {
      return;
    }
    try {
      const content = readFileSync(this.storagePath, "utf-8");
      const data: FailedPattern[] = JSON.parse(content);
      for (const entry of data) {
        this.patterns.set(entry.pattern, entry);
      }
    } catch {
      // Invalid file, start fresh
    }
  }

  private save(): void {
    if (!this.storagePath) {
      return;
    }
    const data = Array.from(this.patterns.values());
    writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
  }
}
