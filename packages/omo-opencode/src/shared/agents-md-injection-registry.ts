/**
 * Shared deduplication registry for AGENTS.md injection paths.
 *
 * Both {@link hephaestus-agents-md-injector} and {@link directory-agents-injector}
 * independently inject AGENTS.md content into session context. This singleton
 * ensures the same AGENTS.md directory is only injected once per session cycle,
 * preventing duplicate context blocks in the conversation transcript.
 *
 * Lifecycle: cleared per-session on compaction (so the instruction is re-supplied
 * after context truncation) and on session deletion.
 */

const injectedDirectories = new Map<string, Set<string>>()

export interface AgentsMdInjectionRegistry {
  /** Returns the set of directories already injected for this session, or undefined. */
  getSessionDirs(sessionID: string): Set<string> | undefined
  /** Marks a directory as injected for this session. */
  mark(sessionID: string, directory: string): void
  /** Clears all tracked directories for this session. */
  clearSession(sessionID: string): void
}

export function getAgentsMdInjectionRegistry(): AgentsMdInjectionRegistry {
  return {
    getSessionDirs(sessionID: string): Set<string> | undefined {
      return injectedDirectories.get(sessionID)
    },

    mark(sessionID: string, directory: string): void {
      const dirs = injectedDirectories.get(sessionID)
      if (dirs) {
        dirs.add(directory)
      } else {
        injectedDirectories.set(sessionID, new Set([directory]))
      }
    },

    clearSession(sessionID: string): void {
      injectedDirectories.delete(sessionID)
    },
  }
}
