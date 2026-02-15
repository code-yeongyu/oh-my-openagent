import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../shared/json-cache";
import { AGENT_USAGE_REMINDER_STORAGE } from "./constants";
import type { AgentUsageState } from "./types";

function getStoragePath(sessionID: string): string {
  return join(AGENT_USAGE_REMINDER_STORAGE, `${sessionID}.json`);
}

export function loadAgentUsageState(sessionID: string): AgentUsageState | null {
  const filePath = getStoragePath(sessionID);
  return readJsonFile<AgentUsageState>(filePath);
}

export function saveAgentUsageState(state: AgentUsageState): void {
  const filePath = getStoragePath(state.sessionID);
  writeJsonFile(filePath, state, { ensureDir: true });
}

export function clearAgentUsageState(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
