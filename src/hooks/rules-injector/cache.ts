import { clearInjectedRules, loadInjectedRules } from "./storage";

export type SessionInjectedRulesCache = {
  contentHashes: Set<string>;
  realPaths: Set<string>;
};

export function createSessionCacheStore(): {
  getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
  clearSessionCache: (sessionID: string) => void;
} {
  const sessionCaches = new Map<string, SessionInjectedRulesCache>();

  function getSessionCache(sessionID: string): SessionInjectedRulesCache {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedRules(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function clearSessionCache(sessionID: string): void {
    sessionCaches.delete(sessionID);
    clearInjectedRules(sessionID);
  }

  return { getSessionCache, clearSessionCache };
}
