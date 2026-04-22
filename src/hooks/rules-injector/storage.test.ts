import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RULES_INJECTOR_STORAGE } from "./constants";
import {
  clearInjectedRules,
  loadInjectedRules,
  saveInjectedRules,
} from "./storage";

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

describe("storage", () => {
  it("reads back only the requested session data from session-scoped files", () => {
    // given
    const firstSessionID = createSessionID("storage-first");
    const secondSessionID = createSessionID("storage-second");

    saveInjectedRules(firstSessionID, {
      contentHashes: new Set(["hash:first"]),
      realPaths: new Set(["/tmp/first-rule.md"]),
    });
    saveInjectedRules(secondSessionID, {
      contentHashes: new Set(["hash:second"]),
      realPaths: new Set(["/tmp/second-rule.md"]),
    });

    // when
    const firstLoaded = loadInjectedRules(firstSessionID);
    const secondLoaded = loadInjectedRules(secondSessionID);

    // then
    expect(existsSync(getStoragePath(firstSessionID))).toBe(true);
    expect(existsSync(getStoragePath(secondSessionID))).toBe(true);
    expect([...firstLoaded.contentHashes]).toEqual(["hash:first"]);
    expect([...firstLoaded.realPaths]).toEqual(["/tmp/first-rule.md"]);
    expect([...secondLoaded.contentHashes]).toEqual(["hash:second"]);
    expect([...secondLoaded.realPaths]).toEqual(["/tmp/second-rule.md"]);
  });
});
