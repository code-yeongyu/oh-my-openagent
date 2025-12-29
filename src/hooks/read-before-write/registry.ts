import type { ReadBeforeWriteConfig, RegistryStats } from "./types";
import { DEFAULT_CONFIG, MAX_TRACKED_FILES, HOOK_NAME } from "./constants";
import { log } from "../../shared";

/**
 * FileReadRegistry - Singleton registry for tracking file reads per session.
 * 
 * Uses an LRU cache implementation based on JavaScript Map's insertion-order guarantee:
 * - Map.keys().next().value returns the oldest entry (first inserted)
 * - Delete + re-insert moves an entry to the end (most recently used)
 * - O(1) lookup, O(1) insertion, O(1) eviction
 * 
 * Data structure: Map<sessionId, Map<normalizedPath, timestamp>>
 */
export class FileReadRegistry {
  private static instance: FileReadRegistry | null = null;
  
  /**
   * Session-scoped LRU caches: Map<sessionId, Map<normalizedPath, timestamp>>
   * The inner Map uses insertion order for LRU semantics.
   */
  private sessions: Map<string, Map<string, number>> = new Map();
  
  private config: ReadBeforeWriteConfig;

  private constructor(config?: Partial<ReadBeforeWriteConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the singleton instance of the registry.
   */
  static getInstance(config?: Partial<ReadBeforeWriteConfig>): FileReadRegistry {
    if (!FileReadRegistry.instance) {
      FileReadRegistry.instance = new FileReadRegistry(config);
    }
    return FileReadRegistry.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing).
   */
  static resetInstance(): void {
    FileReadRegistry.instance = null;
  }

  /**
   * Record a file read for a session.
   * If the file was already read, updates its timestamp and moves it to the end (most recently used).
   * Evicts the oldest entry if the cache exceeds MAX_TRACKED_FILES.
   * 
   * @param sessionId - The session that performed the read
   * @param filePath - Normalized absolute path of the file
   */
  recordRead(sessionId: string, filePath: string): void {
    let sessionCache = this.sessions.get(sessionId);
    
    if (!sessionCache) {
      sessionCache = new Map();
      this.sessions.set(sessionId, sessionCache);
    }

    // If already exists, delete first to move to end (LRU update)
    if (sessionCache.has(filePath)) {
      sessionCache.delete(filePath);
    }

    // Add/re-add at the end (most recently used)
    sessionCache.set(filePath, Date.now());

    // LRU eviction: remove oldest entries if over limit
    while (sessionCache.size > MAX_TRACKED_FILES) {
      const oldestKey = sessionCache.keys().next().value;
      if (oldestKey) {
        sessionCache.delete(oldestKey);
        log(`[${HOOK_NAME}] LRU eviction: removed ${oldestKey} from session ${sessionId}`);
      }
    }

    log(`[${HOOK_NAME}] Recorded read: ${filePath} (session: ${sessionId})`);
  }

  /**
   * Check if a file has been read in a session.
   * 
   * @param sessionId - The session to check
   * @param filePath - Normalized absolute path of the file
   * @returns true if the file was read in this session
   */
  hasRead(sessionId: string, filePath: string): boolean {
    const sessionCache = this.sessions.get(sessionId);
    if (!sessionCache) {
      return false;
    }
    return sessionCache.has(filePath);
  }

  /**
   * Clear all tracking data for a session.
   * Called on session.deleted and session.compacted events.
   * 
   * @param sessionId - The session to clear
   */
  clearSession(sessionId: string): void {
    const sessionCache = this.sessions.get(sessionId);
    if (sessionCache) {
      const count = sessionCache.size;
      this.sessions.delete(sessionId);
      log(`[${HOOK_NAME}] Cleared session ${sessionId} (${count} files tracked)`);
    }
  }

  /**
   * Get statistics about the registry state.
   */
  getStats(): RegistryStats {
    const filesPerSession = new Map<string, number>();
    let totalFilesTracked = 0;

    for (const [sessionId, cache] of this.sessions) {
      filesPerSession.set(sessionId, cache.size);
      totalFilesTracked += cache.size;
    }

    return {
      sessionCount: this.sessions.size,
      totalFilesTracked,
      filesPerSession,
    };
  }

  /**
   * Reset all tracking data (primarily for testing).
   */
  reset(): void {
    this.sessions.clear();
    log(`[${HOOK_NAME}] Registry reset`);
  }

  /**
   * Update the configuration.
   */
  updateConfig(config: Partial<ReadBeforeWriteConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ReadBeforeWriteConfig {
    return { ...this.config };
  }
}
