import { clearInjectedRules, loadInjectedRules } from "./storage";
import { createRuleScanCache } from "./rule-scan-cache";
import type { RuleScanCache } from "./rule-scan-cache";

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

export function createSessionRuleScanCacheStore(): {
  getSessionRuleScanCache: (sessionID: string) => RuleScanCache;
  clearSessionRuleScanCache: (sessionID: string) => void;
} {
  const sessionCaches = new Map<string, RuleScanCache>();

  function getSessionRuleScanCache(sessionID: string): RuleScanCache {
    const existingCache = sessionCaches.get(sessionID);
    if (existingCache) {
      return existingCache;
    }

    const cache = createRuleScanCache();
    sessionCaches.set(sessionID, cache);
    return cache;
  }

  function clearSessionRuleScanCache(sessionID: string): void {
    const cache = sessionCaches.get(sessionID);
    cache?.clear();
    sessionCaches.delete(sessionID);
  }

  return { getSessionRuleScanCache, clearSessionRuleScanCache };
}
