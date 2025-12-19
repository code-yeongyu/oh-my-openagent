import type { FileEditLock, ConflictCheckResult, ConflictDetectorConfig } from "./types";
import { DEFAULT_CONFLICT_DETECTOR_CONFIG } from "./constants";
import { log } from "../../shared";

export class FileEditRegistry {
  private static instance: FileEditRegistry | null = null;
  private locks: Map<string, FileEditLock> = new Map();
  private config: ConflictDetectorConfig;

  private constructor(config?: Partial<ConflictDetectorConfig>) {
    this.config = { ...DEFAULT_CONFLICT_DETECTOR_CONFIG, ...config };
  }

  static getInstance(config?: Partial<ConflictDetectorConfig>): FileEditRegistry {
    if (!FileEditRegistry.instance) {
      FileEditRegistry.instance = new FileEditRegistry(config);
    }
    return FileEditRegistry.instance;
  }

  static resetInstance(): void {
    FileEditRegistry.instance = null;
  }

  private cleanupStaleLocks(): void {
    const now = Date.now();
    const staleKeys: string[] = [];

    for (const [key, lock] of this.locks) {
      if (now - lock.acquiredAt > this.config.lockTimeoutMs) {
        staleKeys.push(key);
        log(`[FileEditRegistry] Releasing stale lock: ${lock.filePath} (${lock.agentName})`);
      }
    }

    for (const key of staleKeys) {
      this.locks.delete(key);
    }
  }

  hasConflict(filePath: string, agentName: string): ConflictCheckResult {
    this.cleanupStaleLocks();

    const existingLock = this.locks.get(filePath);

    if (!existingLock) {
      return { hasConflict: false };
    }

    if (existingLock.agentName === agentName) {
      return { hasConflict: false };
    }

    return {
      hasConflict: true,
      existingLock,
      message: `File "${filePath}" is locked by "${existingLock.agentName}" since ${new Date(existingLock.acquiredAt).toISOString()}`,
    };
  }

  acquireLock(
    filePath: string,
    agentName: string,
    sessionId: string,
    operation: "read" | "write" | "edit"
  ): boolean {
    this.cleanupStaleLocks();

    const conflict = this.hasConflict(filePath, agentName);
    if (conflict.hasConflict && this.config.blockOnConflict) {
      return false;
    }

    const lock: FileEditLock = {
      filePath,
      agentName,
      sessionId,
      acquiredAt: Date.now(),
      operation,
    };

    this.locks.set(filePath, lock);
    log(`[FileEditRegistry] Lock acquired: ${filePath} by ${agentName} (${operation})`);
    return true;
  }

  releaseLock(filePath: string, agentName: string): boolean {
    const existingLock = this.locks.get(filePath);

    if (!existingLock) {
      return false;
    }

    if (existingLock.agentName !== agentName) {
      log(`[FileEditRegistry] Cannot release lock: ${filePath} is locked by ${existingLock.agentName}, not ${agentName}`);
      return false;
    }

    this.locks.delete(filePath);
    log(`[FileEditRegistry] Lock released: ${filePath} by ${agentName}`);
    return true;
  }

  releaseAllLocks(agentName: string): number {
    let released = 0;
    const toRelease: string[] = [];

    for (const [filePath, lock] of this.locks) {
      if (lock.agentName === agentName) {
        toRelease.push(filePath);
      }
    }

    for (const filePath of toRelease) {
      this.locks.delete(filePath);
      released++;
    }

    if (released > 0) {
      log(`[FileEditRegistry] Released ${released} locks for ${agentName}`);
    }

    return released;
  }

  getActiveLocks(): FileEditLock[] {
    this.cleanupStaleLocks();
    return Array.from(this.locks.values());
  }

  getLockForFile(filePath: string): FileEditLock | undefined {
    this.cleanupStaleLocks();
    return this.locks.get(filePath);
  }

  reset(): void {
    this.locks.clear();
  }

  updateConfig(config: Partial<ConflictDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ConflictDetectorConfig {
    return { ...this.config };
  }
}
