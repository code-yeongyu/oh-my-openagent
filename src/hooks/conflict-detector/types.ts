export interface FileEditLock {
  filePath: string;
  agentName: string;
  sessionId: string;
  acquiredAt: number;
  operation: "read" | "write" | "edit";
}

export interface ConflictDetectorConfig {
  enabled: boolean;
  lockTimeoutMs: number;
  warnOnConflict: boolean;
  blockOnConflict: boolean;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  existingLock?: FileEditLock;
  message?: string;
}
