import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createSessionCacheStore } from "./cache";
import { RULES_INJECTOR_STORAGE } from "./constants";
import { clearInjectedRules, saveInjectedRules } from "./storage";

const trackedSessionIDs: string[] = [];

function createSessionID(prefix: string): string {
  const sessionID = `${prefix}-${randomUUID()}`;
  trackedSessionIDs.push(sessionID);
  return sessionID;
}

function getStoragePath(sessionID: string): string {
  return join(RULES_INJECTOR_STORAGE, `${sessionID}.json`);
}

afterEach(() => {
  for (const sessionID of trackedSessionIDs.splice(0)) {
    clearInjectedRules(sessionID);
  }
});

describe("createSessionCacheStore", () => {
  it("keeps factory instances isolated for the same session", () => {
    // given
    const sessionID = createSessionID("cache-isolation");
    const firstStore = createSessionCacheStore();
    const secondStore = createSessionCacheStore();
    const firstCache = firstStore.getSessionCache(sessionID);

    // when
    firstCache.contentHashes.add("hash:first");
    firstCache.realPaths.add("/tmp/first-rule.md");
    const secondCache = secondStore.getSessionCache(sessionID);

    // then
    expect([...secondCache.contentHashes]).toEqual([]);
    expect([...secondCache.realPaths]).toEqual([]);
  });

  it("clears only the targeted session cache and persisted state", () => {
    // given
    const deletedSessionID = createSessionID("deleted-session");
    const retainedSessionID = createSessionID("retained-session");

    saveInjectedRules(deletedSessionID, {
      contentHashes: new Set(["hash:deleted"]),
      realPaths: new Set(["/tmp/deleted-rule.md"]),
    });
    saveInjectedRules(retainedSessionID, {
      contentHashes: new Set(["hash:retained"]),
      realPaths: new Set(["/tmp/retained-rule.md"]),
    });

    const store = createSessionCacheStore();
    store.getSessionCache(deletedSessionID);
    const retainedCache = store.getSessionCache(retainedSessionID);

    // when
    store.clearSessionCache(deletedSessionID);
    const reloadedRetainedCache = store.getSessionCache(retainedSessionID);

    // then
    expect(existsSync(getStoragePath(deletedSessionID))).toBe(false);
    expect(existsSync(getStoragePath(retainedSessionID))).toBe(true);
    expect(reloadedRetainedCache).toBe(retainedCache);
    expect([...reloadedRetainedCache.contentHashes]).toEqual(["hash:retained"]);
    expect([...reloadedRetainedCache.realPaths]).toEqual(["/tmp/retained-rule.md"]);
  });
});
